import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, type PipelineStage } from 'mongoose';
import {
  Artifact,
  ArtifactType,
  CarouselTheme,
  Post,
  PostStatus,
  VersionStatus,
} from 'src/database/schemas';
import { getSignedUrl } from '../s3';
import type { StylePreset } from 'src/agent/style-presets.config';
import type { FailureCode } from 'src/workflow/workflow.constants';
import {
  ArtifactDeletedError,
  ArtifactWriter,
  FailVersionOutcome,
  RefineContext,
  VersionRead,
  VersionRender,
  VersionWriteOptions,
} from './artifact-writer.interface';
import {
  ArtifactContent,
  DocumentContent,
  artifactTitleSchema,
  parseArtifactContent,
} from './schemas';

export interface ArtifactSourceInput {
  prompt: string;
  withResearch: boolean;
  stylePreset?: StylePreset;
  theme?: CarouselTheme;
}

export interface CreateArtifactInput extends ArtifactSourceInput {
  type: ArtifactType;
}

export interface RefineArtifactInput extends ArtifactSourceInput {
  version: number;
  type: ArtifactType;
}

export interface ArtifactListQuery {
  type?: ArtifactType;
  status?: VersionStatus;
  month?: string;
  search?: string;
  page?: number;
}

export interface ArtifactGetOptions {
  version?: number;
  includeVersions?: boolean;
}

export interface UpdateArtifactInput {
  title?: string;
  content?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ArtifactPreview {
  commentary?: string;
  firstSlide?: unknown;
  pdfUrl?: string;
}

export interface ArtifactSummary {
  id: string;
  type: ArtifactType;
  title?: string;
  status: VersionStatus;
  updatedAt: Date;
  preview: ArtifactPreview;
}

export interface ArtifactVersionMetadata {
  version: number;
  status: VersionStatus;
  createdAt: Date;
  editedAt?: Date;
  refineFeedback?: string;
}

export interface ArtifactDetail {
  id: string;
  type: ArtifactType;
  title?: string;
  currentVersion?: number;
  version: number;
  status: VersionStatus;
  updatedAt?: Date;
  content: Record<string, unknown>;
  versions?: ArtifactVersionMetadata[];
}

export interface ArtifactListResult {
  data: ArtifactSummary[];
  filters: {
    availableMonths: string[];
    types: ArtifactType[];
  };
  page: number;
  pages: number;
}

const ARTIFACT_PAGE_SIZE = 20;
const PREVIEW_SNIPPET_LENGTH = 240;

interface ArtifactListRow {
  _id: Types.ObjectId | string;
  type: ArtifactType;
  title?: string;
  updatedAt: Date;
  _latestVersion: {
    version: number;
    status: VersionStatus;
    content?: Record<string, unknown>;
  } | null;
}

type ValidArtifactListRow = ArtifactListRow & {
  _latestVersion: NonNullable<ArtifactListRow['_latestVersion']>;
};

interface ArtifactListAggregateResult {
  data: ArtifactListRow[];
  metadata: Array<{ total: number }>;
}

interface ArtifactTimestampFields {
  createdAt?: Date;
  updatedAt?: Date;
}

type TimestampedArtifact = Artifact & ArtifactTimestampFields;
@Injectable()
export class ArtifactService implements ArtifactWriter {
  constructor(
    @InjectModel(Artifact.name) private readonly artifactModel: Model<Artifact>,
    @InjectModel(Post.name) private readonly postModel: Model<Post>,
  ) {}

  async createArtifact(
    userId: string,
    input: CreateArtifactInput,
  ): Promise<Artifact> {
    return this.artifactModel.create({
      user: new Types.ObjectId(userId),
      type: input.type,
      source: {
        prompt: input.prompt,
        withResearch: input.withResearch,
        ...(input.stylePreset ? { stylePreset: input.stylePreset } : {}),
        ...(input.theme ? { theme: input.theme } : {}),
      },
      // No currentVersion until v1 is promoted to READY.
      versions: [{ version: 1, status: VersionStatus.GENERATING }],
    });
  }

  /**
   * Appends a `GENERATING` Attempt that refines the Current Version. The
   * Current Version does not move: only promotion moves it, once the Attempt
   * is `READY`. At most one Attempt is in flight, enforced by the write itself
   * so two concurrent refines cannot both append.
   */
  async appendRefineVersion(
    userId: string,
    artifactId: string,
    feedback: string,
  ): Promise<RefineArtifactInput> {
    const user = new Types.ObjectId(userId);
    const artifact = await this.artifactModel.findOne({
      _id: artifactId,
      user,
    });

    if (!artifact || artifact.deletedAt) {
      throw new NotFoundException(`Artifact ${artifactId} not found`);
    }

    if (
      artifact.versions.some((item) => item.status === VersionStatus.GENERATING)
    ) {
      throw new ConflictException(
        `Artifact ${artifactId} is still generating and cannot be refined`,
      );
    }

    const base = artifact.versions.find(
      (item) =>
        item.version === artifact.currentVersion &&
        item.status === VersionStatus.READY,
    );
    if (!base) {
      throw new ConflictException(
        `Artifact ${artifactId} has no ready version to refine`,
      );
    }

    let theme = artifact.source.theme;
    if (!theme && artifact.type === ArtifactType.DOCUMENT) {
      const baseContent = parseArtifactContent(artifact.type, base.content);
      if ('document' in baseContent) {
        theme = baseContent.document.templateId;
      }
    }

    // Numbers are never reused, so a failed Attempt keeps its number forever.
    const nextVersion =
      Math.max(...artifact.versions.map((item) => item.version)) + 1;
    const result = await this.artifactModel.updateOne(
      {
        _id: artifact._id,
        user,
        deletedAt: { $exists: false },
        currentVersion: base.version,
        'versions.status': { $ne: VersionStatus.GENERATING },
        'versions.version': { $ne: nextVersion },
      },
      {
        $push: {
          versions: {
            version: nextVersion,
            status: VersionStatus.GENERATING,
            refineFeedback: feedback,
            parentVersion: base.version,
          },
        },
      },
    );

    if (result.matchedCount !== 1) {
      throw new ConflictException(
        `Artifact ${artifactId} changed while a refine was being started`,
      );
    }

    return {
      version: nextVersion,
      type: artifact.type,
      prompt: artifact.source.prompt,
      withResearch: artifact.source.withResearch,
      ...(artifact.source.stylePreset
        ? { stylePreset: artifact.source.stylePreset }
        : {}),
      ...(theme ? { theme } : {}),
    };
  }

  /** The refine's base is the Current Version recorded when it was appended. */
  async readRefineInput(
    artifactId: string,
    version: number,
  ): Promise<RefineContext> {
    const artifact = await this.getLiveArtifact(artifactId);
    const target = artifact.versions.find((item) => item.version === version);
    const base = artifact.versions.find(
      (item) =>
        target?.parentVersion !== undefined &&
        item.version === target.parentVersion &&
        item.status === VersionStatus.READY,
    );

    if (!target || target.refineFeedback == null || !base) {
      throw new NotFoundException(
        `Refine input for artifact ${artifactId} v${version} not found`,
      );
    }

    return {
      priorContent: parseArtifactContent(artifact.type, base.content),
      feedback: target.refineFeedback,
    };
  }

  /**
   * The only write that makes a version `READY`, and the only one that moves
   * `currentVersion`, in the same update. It matches only a live artifact whose
   * target version is still `GENERATING`, so it can neither resurrect a failed
   * Attempt nor write into a deleted artifact.
   */
  async promoteVersion(
    artifactId: string,
    version: number,
    content: ArtifactContent,
    options: VersionWriteOptions = {},
  ): Promise<void> {
    const artifact = await this.getLiveArtifact(artifactId);
    if (!artifact.versions.some((v) => v.version === version)) {
      throw new NotFoundException(
        `Version ${version} not found on artifact ${artifactId}`,
      );
    }

    // For a DOCUMENT, fold RENDER_PDF's derived output onto the slides-only
    // content GENERATE produced; POST/POLL carry no document to fold into.
    const folded = this.foldRender(artifact.type, content, options.render);
    const parsed = parseArtifactContent(artifact.type, folded);
    const title =
      version === 1 && options.title !== undefined
        ? artifactTitleSchema.parse(options.title)
        : undefined;

    // RENDER_PDF is what gates READY for a document: without a rendered pdfKey the
    // deck has no preview, so this flip would publish a half-built version.
    if (
      artifact.type === ArtifactType.DOCUMENT &&
      !(parsed as DocumentContent).document.pdfKey
    ) {
      throw new Error(
        `Cannot mark document ${artifactId} v${version} READY without a rendered pdfKey`,
      );
    }

    const result = await this.artifactModel.updateOne(
      {
        _id: artifact._id,
        deletedAt: { $exists: false },
        versions: {
          $elemMatch: { version, status: VersionStatus.GENERATING },
        },
      },
      {
        $set: {
          ...(title !== undefined ? { title } : {}),
          'versions.$.content': parsed,
          'versions.$.status': VersionStatus.READY,
          currentVersion: version,
        },
      },
    );
    if (result.matchedCount === 1) {
      return;
    }

    // Nothing matched. A replay of a promotion that already landed is success;
    // anything else means this Attempt can no longer become READY.
    const latest = await this.getLiveArtifact(artifactId);
    const target = latest.versions.find((v) => v.version === version);
    if (target?.status === VersionStatus.READY) {
      return;
    }
    throw new ConflictException(
      `Version ${version} of artifact ${artifactId} is ${target?.status ?? 'missing'} and cannot be promoted`,
    );
  }

  /**
   * Terminal end of a run: the Attempt keeps its place in the history as
   * `FAILED`, with its failure code and reason and no content. Only a
   * `GENERATING` Attempt is failed, so a version a promotion already made READY
   * is never overwritten.
   */
  async failVersion(
    artifactId: string,
    version: number,
    failureCode: FailureCode,
    failureReason: string,
  ): Promise<FailVersionOutcome> {
    const artifact = await this.artifactModel.findById(artifactId);
    if (!artifact) {
      throw new NotFoundException(`Artifact ${artifactId} not found`);
    }
    const result = await this.artifactModel.updateOne(
      {
        _id: artifact._id,
        versions: {
          $elemMatch: { version, status: VersionStatus.GENERATING },
        },
      },
      {
        $set: {
          'versions.$.status': VersionStatus.FAILED,
          'versions.$.failureCode': failureCode,
          'versions.$.failureReason': failureReason,
        },
        $unset: { 'versions.$.content': '' },
      },
    );
    // A deleted artifact's Attempt is still failed, so a direct link never
    // shows it in flight; the caller only needs to know not to announce it.
    if (artifact.deletedAt) {
      return 'ARTIFACT_DELETED';
    }
    return result.matchedCount === 1 ? 'FAILED' : 'NOT_GENERATING';
  }

  async readVersion(artifactId: string, version: number): Promise<VersionRead> {
    const artifact = await this.getLiveArtifact(artifactId);
    const target = artifact.versions.find((v) => v.version === version);
    if (!target) {
      throw new NotFoundException(
        `Version ${version} not found on artifact ${artifactId}`,
      );
    }
    return { type: artifact.type, version, status: target.status };
  }

  /**
   * Lists only the current-version summary for each live artifact. The current
   * version is selected in Mongo so a status filter can never match an older
   * version in the embedded history.
   */
  async listArtifacts(
    userId: string,
    query: ArtifactListQuery = {},
  ): Promise<ArtifactListResult> {
    const ownerId = this.toObjectId(userId);
    const page = Math.max(1, query.page ?? 1);
    const pageMatch: Record<string, unknown> = {
      user: ownerId,
      deletedAt: { $exists: false },
    };

    if (query.type) {
      pageMatch.type = query.type;
    }

    const search = query.search?.trim();
    if (search) {
      const literalSearch = new RegExp(
        search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i',
      );
      pageMatch.$or = [
        { title: literalSearch },
        { 'source.prompt': literalSearch },
      ];
    }

    const monthRange = this.monthRange(query.month);
    if (monthRange) {
      pageMatch.updatedAt = {
        $gte: monthRange.start,
        $lt: monthRange.end,
      };
    }

    // Versions are only ever appended as max + 1, so the last element is the
    // newest version: the Current Version, or an Attempt made after it.
    const versionsExpression = { $ifNull: ['$versions', []] };
    const latestVersionExpression = { $arrayElemAt: [versionsExpression, -1] };
    const hasVersionMatch = {
      $match: {
        $expr: {
          $gt: [{ $size: versionsExpression }, 0],
        },
      },
    };

    const statusMatch = query.status
      ? [{ $match: { '_latestVersion.status': query.status } }]
      : [];

    const listPipeline = [
      { $match: pageMatch },
      hasVersionMatch,
      { $set: { _latestVersion: latestVersionExpression } },
      ...statusMatch,
      { $sort: { updatedAt: -1, _id: -1 } },
      {
        $facet: {
          data: [
            { $skip: (page - 1) * ARTIFACT_PAGE_SIZE },
            { $limit: ARTIFACT_PAGE_SIZE },
            {
              $project: {
                _id: 1,
                type: 1,
                title: 1,
                updatedAt: 1,
                _latestVersion: 1,
              },
            },
          ],
          metadata: [{ $count: 'total' }],
        },
      },
    ] as PipelineStage[];

    const filterMatch = {
      user: ownerId,
      deletedAt: { $exists: false },
    };

    const [listResult, availableMonthsResult, artifactTypes] =
      await Promise.all([
        this.artifactModel
          .aggregate<ArtifactListAggregateResult>(listPipeline)
          .exec(),
        this.artifactModel
          .aggregate<{ month: string }>([
            { $match: filterMatch },
            hasVersionMatch,
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: '%Y-%m',
                    date: '$createdAt',
                  },
                },
              },
            },
            { $sort: { _id: -1 } },
            { $project: { _id: 0, month: '$_id' } },
          ])
          .exec(),
        this.artifactModel.distinct('type', {
          ...filterMatch,
          ...hasVersionMatch.$match,
        }),
      ]);

    const aggregateResult = listResult[0] ?? { data: [], metadata: [] };
    const total = aggregateResult.metadata[0]?.total ?? 0;
    const data = await Promise.all(
      aggregateResult.data
        // The aggregation excludes these rows; keep the boundary defensive in
        // case a mock or future pipeline change returns malformed data.
        .filter(
          (row): row is ValidArtifactListRow => row._latestVersion !== null,
        )
        .map((row) => this.toSummary(row)),
    );

    const enumOrder = new Map(
      Object.values(ArtifactType).map((type, index) => [type, index]),
    );
    const types: ArtifactType[] = artifactTypes.sort(
      (left, right) =>
        (enumOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (enumOrder.get(right) ?? Number.MAX_SAFE_INTEGER),
    );

    return {
      data,
      filters: {
        availableMonths: availableMonthsResult.map((item) => item.month),
        types,
      },
      page,
      pages: Math.ceil(total / ARTIFACT_PAGE_SIZE),
    };
  }

  /**
   * Reads a selected version, including soft-deleted artifacts for direct
   * links. Without one it reads the newest version, which is an Attempt while a
   * refine is in flight or after one failed. Version history is deliberately
   * metadata-only.
   */
  async getArtifact(
    userId: string,
    artifactId: string,
    options: ArtifactGetOptions = {},
  ): Promise<ArtifactDetail> {
    const artifact = await this.getOwnedArtifact(userId, artifactId, true);
    const versionNumber =
      options.version ??
      artifact.versions[artifact.versions.length - 1]?.version;
    const version = artifact.versions.find(
      (candidate) => candidate.version === versionNumber,
    );

    if (!version) {
      throw new NotFoundException(
        `Version ${versionNumber} not found on artifact ${artifactId}`,
      );
    }

    return this.toDetail(artifact, version, options.includeVersions === true);
  }

  /**
   * Applies a partial editor update to the current READY version. The
   * update's query repeats the READY check so a concurrent generation cannot
   * be edited after the initial read.
   */
  async updateArtifact(
    userId: string,
    artifactId: string,
    input: UpdateArtifactInput,
  ): Promise<ArtifactDetail> {
    const ownerId = this.toObjectId(userId);
    const artifact = await this.getOwnedArtifact(userId, artifactId, false);
    const current = artifact.versions.find(
      (version) => version.version === artifact.currentVersion,
    );

    if (!current) {
      throw new ConflictException(
        `Artifact ${artifactId} has no ready version to edit`,
      );
    }

    if (current.status !== VersionStatus.READY) {
      throw new ConflictException(
        `Artifact ${artifactId} cannot be edited while version ${current.version} is ${current.status}`,
      );
    }

    // A refine reads the Current Version's content when its run starts, so an
    // edit while one is in flight would silently change the refine's input.
    const attempt = artifact.versions.find(
      (version) => version.status === VersionStatus.GENERATING,
    );
    if (attempt) {
      throw new ConflictException(
        `Artifact ${artifactId} cannot be edited while version ${attempt.version} is GENERATING`,
      );
    }

    const pinned = await this.postModel.exists({
      artifacts: {
        $elemMatch: {
          artifact: artifact._id,
          version: current.version,
        },
      },
      status: { $in: [PostStatus.SCHEDULED, PostStatus.PUBLISHED] },
    });
    if (pinned) {
      throw new ConflictException(
        `Artifact ${artifactId} version ${current.version} is pinned by a scheduled or published post`,
      );
    }

    const contentPatch = this.contentPatch(input);
    let parsedContent: ArtifactContent;
    let parsedTitle: string | undefined;
    try {
      parsedContent = parseArtifactContent(
        artifact.type,
        this.mergeRecords(current.content ?? {}, contentPatch),
      );
      parsedTitle =
        input.title !== undefined
          ? artifactTitleSchema.parse(input.title)
          : undefined;
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid artifact content',
      );
    }

    const editedAt = new Date();
    const set: Record<string, unknown> = {
      'versions.$.content': parsedContent,
      'versions.$.editedAt': editedAt,
    };
    if (parsedTitle !== undefined) {
      set.title = parsedTitle;
    }

    const updated = await this.artifactModel.findOneAndUpdate(
      {
        _id: artifact._id,
        user: ownerId,
        deletedAt: { $exists: false },
        currentVersion: artifact.currentVersion,
        ...(artifact.pinRevision
          ? { pinRevision: artifact.pinRevision }
          : {
              $or: [{ pinRevision: 0 }, { pinRevision: { $exists: false } }],
            }),
        versions: {
          $elemMatch: {
            version: current.version,
            status: VersionStatus.READY,
          },
        },
      },
      { $set: set },
      { new: true },
    );

    if (!updated) {
      throw new ConflictException(
        `Artifact ${artifactId} changed before the edit could be saved`,
      );
    }

    const updatedArtifact = updated;
    const updatedVersion = updatedArtifact.versions.find(
      (version) => version.version === artifact.currentVersion,
    );
    return this.toDetail(
      updatedArtifact,
      updatedVersion ?? { ...current, content: parsedContent, editedAt },
      false,
    );
  }

  async deleteArtifact(
    userId: string,
    artifactId: string,
  ): Promise<{ id: string; deletedAt: Date }> {
    const ownerId = this.toObjectId(userId);
    const artifact = await this.getOwnedArtifact(userId, artifactId, false);
    const deletedAt = new Date();
    const result = await this.artifactModel.updateOne(
      {
        _id: artifact._id,
        user: ownerId,
        deletedAt: { $exists: false },
      },
      { $set: { deletedAt } },
    );

    if (result?.matchedCount === 0) {
      throw new NotFoundException(`Artifact ${artifactId} not found`);
    }

    return { id: artifact._id.toString(), deletedAt };
  }

  /**
   * Folds RENDER_PDF's `pdfKey`/`pageCount` onto a document's slides-only
   * content. A no-op for POST/POLL (no document object) and for a document
   * reached without a render (the gate below rejects that separately).
   */
  private foldRender(
    type: ArtifactType,
    content: ArtifactContent,
    render?: VersionRender,
  ): ArtifactContent {
    if (type !== ArtifactType.DOCUMENT || !render || !('document' in content)) {
      return content;
    }
    return {
      ...content,
      document: {
        ...content.document,
        pdfKey: render.pdfKey,
        pageCount: render.pageCount,
      },
    };
  }

  private async toSummary(row: ValidArtifactListRow): Promise<ArtifactSummary> {
    const content = row._latestVersion.content ?? {};
    const preview = await this.toPreview(row.type, content);
    return {
      id: row._id.toString(),
      type: row.type,
      ...(row.title !== undefined ? { title: row.title } : {}),
      status: row._latestVersion.status,
      updatedAt: row.updatedAt,
      preview,
    };
  }

  private async toPreview(
    type: ArtifactType,
    rawContent: Record<string, unknown>,
  ): Promise<ArtifactPreview> {
    const content = await this.serializeContent(type, rawContent);
    const preview: ArtifactPreview = {};
    const commentary = content.commentary;
    if (typeof commentary === 'string') {
      preview.commentary = this.snippet(commentary);
    }

    if (type !== ArtifactType.DOCUMENT) {
      return preview;
    }

    const document = this.recordValue(content.document);
    const slides = document?.slides;
    if (Array.isArray(slides) && slides.length > 0) {
      preview.firstSlide = slides[0];
    }
    if (typeof document?.pdfUrl === 'string') {
      preview.pdfUrl = document.pdfUrl;
    }
    return preview;
  }

  private async toDetail(
    artifact: TimestampedArtifact,
    version: Artifact['versions'][number],
    includeVersions: boolean,
  ): Promise<ArtifactDetail> {
    const detail: ArtifactDetail = {
      id: artifact._id.toString(),
      type: artifact.type,
      ...(artifact.title !== undefined ? { title: artifact.title } : {}),
      ...(artifact.currentVersion !== undefined
        ? { currentVersion: artifact.currentVersion }
        : {}),
      version: version.version,
      status: version.status,
      ...(artifact.updatedAt ? { updatedAt: artifact.updatedAt } : {}),
      content: await this.serializeContent(
        artifact.type,
        version.content ?? {},
      ),
    };

    if (includeVersions) {
      detail.versions = artifact.versions.map((candidate) => {
        const metadata: ArtifactVersionMetadata = {
          version: candidate.version,
          status: candidate.status,
          createdAt: candidate.createdAt,
        };
        if (candidate.editedAt !== undefined) {
          metadata.editedAt = candidate.editedAt;
        }
        if (candidate.refineFeedback !== undefined) {
          metadata.refineFeedback = candidate.refineFeedback;
        }
        return metadata;
      });
    }

    return detail;
  }

  private async serializeContent(
    type: ArtifactType,
    rawContent: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (type !== ArtifactType.DOCUMENT) {
      return rawContent;
    }

    const document = this.recordValue(rawContent.document);
    if (!document) {
      return { ...rawContent };
    }

    const pdfKey = typeof document.pdfKey === 'string' ? document.pdfKey : null;
    const safeDocument = { ...document };
    delete safeDocument.pdfKey;
    delete safeDocument.pdfUrl;
    const signedDocument = { ...safeDocument };
    if (pdfKey) {
      signedDocument.pdfUrl = await getSignedUrl(pdfKey);
    }

    return { ...rawContent, document: signedDocument };
  }

  private contentPatch(input: UpdateArtifactInput): Record<string, unknown> {
    const directContent =
      input.content !== undefined ? { ...input.content } : { ...input };
    delete directContent.title;
    delete directContent.content;

    const document = this.recordValue(directContent.document);
    if (document) {
      const editableDocument = { ...document };
      delete editableDocument.pdfKey;
      delete editableDocument.pageCount;
      delete editableDocument.pdfUrl;
      directContent.document = editableDocument;
    }

    return directContent;
  }

  private mergeRecords(
    base: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Record<string, unknown> {
    const merged = { ...base };
    for (const [key, value] of Object.entries(patch)) {
      const baseValue = this.recordValue(merged[key]);
      const patchValue = this.recordValue(value);
      merged[key] =
        baseValue && patchValue
          ? this.mergeRecords(baseValue, patchValue)
          : value;
    }
    return merged;
  }

  private recordValue(value: unknown): Record<string, unknown> | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private snippet(value: string): string {
    if (value.length <= PREVIEW_SNIPPET_LENGTH) {
      return value;
    }
    return `${value.slice(0, PREVIEW_SNIPPET_LENGTH - 1)}…`;
  }

  private monthRange(month?: string): { start: Date; end: Date } | null {
    if (!month) {
      return null;
    }
    const [year, monthNumber] = month.split('-').map(Number);
    if (!year || !monthNumber) {
      return null;
    }
    return {
      start: new Date(year, monthNumber - 1, 1),
      end: new Date(year, monthNumber, 1),
    };
  }

  private async getOwnedArtifact(
    userId: string,
    artifactId: string,
    includeDeleted: boolean,
  ): Promise<TimestampedArtifact> {
    this.toObjectId(artifactId);
    const artifact = await this.artifactModel.findById(artifactId);
    if (!artifact) {
      throw new NotFoundException(`Artifact ${artifactId} not found`);
    }

    if (this.objectIdString(artifact.user) !== userId) {
      throw new ForbiddenException(
        'You are not authorized to access this artifact',
      );
    }

    if (!includeDeleted && artifact.deletedAt) {
      throw new NotFoundException(`Artifact ${artifactId} not found`);
    }
    return artifact;
  }

  private toObjectId(value: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) {
      throw new NotFoundException(`Artifact ${value} not found`);
    }
    return new Types.ObjectId(value);
  }

  private objectIdString(value: unknown): string {
    const record = this.recordValue(value);
    if (record && '_id' in record) {
      return String(record._id);
    }
    return String(value);
  }

  /** For the run's own reads and writes: a deletion mid-run is not a bug. */
  private async getLiveArtifact(artifactId: string): Promise<Artifact> {
    const artifact = await this.artifactModel.findById(artifactId);
    if (!artifact) {
      throw new NotFoundException(`Artifact ${artifactId} not found`);
    }
    if (artifact.deletedAt) {
      throw new ArtifactDeletedError(artifactId);
    }
    return artifact;
  }
}
