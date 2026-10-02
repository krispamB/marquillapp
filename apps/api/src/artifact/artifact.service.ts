import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, type PipelineStage } from 'mongoose';
import {
  Artifact,
  ArtifactType,
  Post,
  PostStatus,
  VersionStatus,
} from 'src/database/schemas';
import { getSignedUrl } from '../s3';
import type { StylePreset } from 'src/agent/style-presets.config';
import type { FailureCode } from 'src/workflow/workflow.constants';
import { WorkflowRunService } from 'src/workflow/workflow-run.service';
import { DesignSystemsService } from '../design-system/design-systems.service';
import {
  ArtifactDeletedError,
  ArtifactWriter,
  FailVersionOutcome,
  RefineContext,
  VersionRead,
  VersionWriteOptions,
} from './artifact-writer.interface';
import {
  ArtifactContent,
  DocumentContent,
  DocumentVersion,
  artifactTitleSchema,
  parseArtifactContent,
} from './schemas';
import {
  LatestAttempt,
  artifactStatusFilter,
  deriveArtifactStatus,
  latestAttemptOf,
  newestVersion,
} from './attempt-reporting';

export interface ArtifactSourceInput {
  prompt: string;
  withResearch: boolean;
  stylePreset?: StylePreset;
}

export interface CreateArtifactInput extends ArtifactSourceInput {
  type: ArtifactType;
  /**
   * DOCUMENT only: the Design System the user asked for, recorded as the
   * request. The version itself is pinned at kickoff.
   */
  designSystemId?: string;
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
  pdfUrl?: string;
  pageCount?: number;
  /** Signed PNG of page 1; absent when the cover capture failed. */
  coverUrl?: string;
}

export interface ArtifactSummary {
  id: string;
  type: ArtifactType;
  title?: string;
  /** Derived; see `deriveArtifactStatus`. */
  status: VersionStatus;
  currentVersion?: number;
  latestAttempt?: LatestAttempt;
  updatedAt: Date;
  /** Built from the Current Version only; empty while there is none. */
  preview: ArtifactPreview;
}

export interface ArtifactVersionMetadata {
  version: number;
  status: VersionStatus;
  createdAt: Date;
  editedAt?: Date;
  refineFeedback?: string;
  failureCode?: FailureCode;
  failureReason?: string;
}

export interface ArtifactDetail {
  id: string;
  type: ArtifactType;
  title?: string;
  currentVersion?: number;
  latestAttempt?: LatestAttempt;
  /** The returned version and its own status. */
  version: number;
  status: VersionStatus;
  failureCode?: FailureCode;
  failureReason?: string;
  updatedAt?: Date;
  /** `{}` unless the returned version is `READY`. */
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
/** Signed object URLs are minted per read and live for one hour. */
const SIGNED_URL_TTL_SECONDS = 3600;

interface ArtifactListRow {
  _id: Types.ObjectId | string;
  type: ArtifactType;
  title?: string;
  updatedAt: Date;
  currentVersion?: number | null;
  _attemptInFlight?: boolean;
  _latestVersion: {
    version: number;
    status: VersionStatus;
    failureCode?: FailureCode;
    failureReason?: string;
  } | null;
  /** The Current Version's content, which the preview is built from. */
  _currentContent?: Record<string, unknown> | null;
}

type ValidArtifactListRow = ArtifactListRow & {
  _latestVersion: NonNullable<ArtifactListRow['_latestVersion']>;
};

type AttemptWithoutRun = Omit<LatestAttempt, 'runId'>;

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
    private readonly workflowRuns: WorkflowRunService,
    private readonly designSystems: DesignSystemsService,
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
        ...(input.designSystemId
          ? { designSystemId: input.designSystemId }
          : {}),
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

    // Refining a Document Version needs its Candidate Source in the prompt,
    // which arrives with #171. Until then it is refused before anything is
    // appended or charged.
    if (artifact.type === ArtifactType.DOCUMENT) {
      throw new UnprocessableEntityException(
        'Refining a document is not available yet',
      );
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

    // The content union is the READY gate: a DOCUMENT parses only as a
    // complete Document Version, whose objects RENDER_PDF already wrote.
    const parsed = parseArtifactContent(artifact.type, content);
    const title =
      version === 1 && options.title !== undefined
        ? artifactTitleSchema.parse(options.title)
        : undefined;

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

    // Nothing matched. A replay of a promotion that already landed is success
    // (for a DOCUMENT, only of the same Document Source); anything else means
    // this Attempt can no longer become READY.
    const latest = await this.getLiveArtifact(artifactId);
    const target = latest.versions.find((v) => v.version === version);
    if (
      target?.status === VersionStatus.READY &&
      this.isSamePromotion(artifact.type, target.content, parsed)
    ) {
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
   * Lists a summary of each live artifact: its derived status, its Current
   * Version, and its latest Attempt. The status filter is the same derivation
   * expressed on stored fields, applied in Mongo before pagination.
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

    if (query.status) {
      Object.assign(pageMatch, artifactStatusFilter(query.status));
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

    const listPipeline = [
      { $match: pageMatch },
      hasVersionMatch,
      { $sort: { updatedAt: -1, _id: -1 } },
      {
        $facet: {
          data: [
            { $skip: (page - 1) * ARTIFACT_PAGE_SIZE },
            { $limit: ARTIFACT_PAGE_SIZE },
            {
              $set: {
                _latestVersion: latestVersionExpression,
                _currentVersionEntry: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: versionsExpression,
                        as: 'candidate',
                        cond: {
                          $eq: ['$$candidate.version', '$currentVersion'],
                        },
                      },
                    },
                    0,
                  ],
                },
                _attemptInFlight: {
                  $in: [
                    VersionStatus.GENERATING,
                    { $ifNull: ['$versions.status', []] },
                  ],
                },
              },
            },
            {
              $project: {
                _id: 1,
                type: 1,
                title: 1,
                updatedAt: 1,
                currentVersion: 1,
                _attemptInFlight: 1,
                '_latestVersion.version': 1,
                '_latestVersion.status': 1,
                '_latestVersion.failureCode': 1,
                '_latestVersion.failureReason': 1,
                _currentContent: '$_currentVersionEntry.content',
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
    // The aggregation excludes these rows; keep the boundary defensive in
    // case a mock or future pipeline change returns malformed data.
    const rows = aggregateResult.data.filter(
      (row): row is ValidArtifactListRow => row._latestVersion != null,
    );
    const attempts = new Map(
      rows.flatMap((row) => {
        const attempt = latestAttemptOf(
          row.currentVersion ?? undefined,
          row._latestVersion,
        );
        return attempt ? [[row._id.toString(), attempt] as const] : [];
      }),
    );
    const runIds = await this.findAttemptRunIds(attempts);
    const data = await Promise.all(
      rows.map((row) => {
        const id = row._id.toString();
        return this.toSummary(
          row,
          this.withRunId(id, attempts.get(id), runIds),
        );
      }),
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
   * links. Without one it reads the Current Version, or the latest Attempt
   * while there is none; an Attempt newer than the Current Version is reported
   * alongside as `latestAttempt`. Version history is deliberately
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
      artifact.currentVersion ??
      newestVersion(artifact.versions)?.version;
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

    if (artifact.type === ArtifactType.DOCUMENT) {
      this.assertDocumentEditable(input);
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
   * Whether an already-READY version holds what a replay would promote. Only a
   * DOCUMENT can tell: the same `sourceSha256` is the same Document Source.
   */
  private isSamePromotion(
    type: ArtifactType,
    stored: Record<string, unknown> | undefined,
    replayed: ArtifactContent,
  ): boolean {
    if (type !== ArtifactType.DOCUMENT) {
      return true;
    }
    const storedDocument = this.recordValue(stored?.document);
    return (
      storedDocument?.sourceSha256 ===
      (replayed as DocumentContent).document.sourceSha256
    );
  }

  private async toSummary(
    row: ValidArtifactListRow,
    latestAttempt: LatestAttempt | undefined,
  ): Promise<ArtifactSummary> {
    const currentVersion = row.currentVersion ?? undefined;
    const preview =
      currentVersion !== undefined && row._currentContent
        ? await this.toPreview(row.type, row._currentContent)
        : {};
    return {
      id: row._id.toString(),
      type: row.type,
      ...(row.title !== undefined ? { title: row.title } : {}),
      status: deriveArtifactStatus(
        row._attemptInFlight === true,
        currentVersion,
      ),
      ...(currentVersion !== undefined ? { currentVersion } : {}),
      ...(latestAttempt ? { latestAttempt } : {}),
      updatedAt: row.updatedAt,
      preview,
    };
  }

  /**
   * One query for every Attempt on a page, keyed by artifact id. Runs come
   * oldest first, so the newest run for a version wins.
   */
  private async findAttemptRunIds(
    attempts: ReadonlyMap<string, AttemptWithoutRun>,
  ): Promise<Map<string, string>> {
    const runIds = new Map<string, string>();
    if (attempts.size === 0) {
      return runIds;
    }
    const runs = await this.workflowRuns.findRunsForVersions(
      [...attempts].map(([artifactId, attempt]) => ({
        artifactId,
        version: attempt.version,
      })),
    );
    for (const run of runs) {
      if (attempts.get(run.artifactId)?.version === run.version) {
        runIds.set(run.artifactId, run.runId);
      }
    }
    return runIds;
  }

  private withRunId(
    artifactId: string,
    attempt: AttemptWithoutRun | undefined,
    runIds: ReadonlyMap<string, string>,
  ): LatestAttempt | undefined {
    if (!attempt) {
      return undefined;
    }
    const runId = runIds.get(artifactId);
    return runId ? { ...attempt, runId } : attempt;
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
    if (typeof document?.pdfUrl === 'string') {
      preview.pdfUrl = document.pdfUrl;
    }
    if (typeof document?.pageCount === 'number') {
      preview.pageCount = document.pageCount;
    }
    const coverKey = this.recordValue(rawContent.document)?.coverKey;
    if (typeof coverKey === 'string') {
      preview.coverUrl = await getSignedUrl(coverKey, SIGNED_URL_TTL_SECONDS);
    }
    return preview;
  }

  private async toDetail(
    artifact: TimestampedArtifact,
    version: Artifact['versions'][number],
    includeVersions: boolean,
  ): Promise<ArtifactDetail> {
    const artifactId = artifact._id.toString();
    const attempt = latestAttemptOf(
      artifact.currentVersion ?? undefined,
      newestVersion(artifact.versions),
    );
    const latestAttempt = this.withRunId(
      artifactId,
      attempt,
      await this.findAttemptRunIds(
        new Map(attempt ? [[artifactId, attempt]] : []),
      ),
    );
    const failed = version.status === VersionStatus.FAILED;

    const detail: ArtifactDetail = {
      id: artifactId,
      type: artifact.type,
      ...(artifact.title !== undefined ? { title: artifact.title } : {}),
      ...(artifact.currentVersion != null
        ? { currentVersion: artifact.currentVersion }
        : {}),
      ...(latestAttempt ? { latestAttempt } : {}),
      version: version.version,
      status: version.status,
      ...(failed && version.failureCode
        ? { failureCode: version.failureCode }
        : {}),
      ...(failed && version.failureReason !== undefined
        ? { failureReason: version.failureReason }
        : {}),
      ...(artifact.updatedAt ? { updatedAt: artifact.updatedAt } : {}),
      // Only a READY version has content; an Attempt never shows any.
      content:
        version.status === VersionStatus.READY
          ? await this.serializeContent(artifact.type, version.content ?? {})
          : {},
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
        if (candidate.status === VersionStatus.FAILED) {
          if (candidate.failureCode) {
            metadata.failureCode = candidate.failureCode;
          }
          if (candidate.failureReason !== undefined) {
            metadata.failureReason = candidate.failureReason;
          }
        }
        return metadata;
      });
    }

    return detail;
  }

  /**
   * The client's view of a version's content. For a DOCUMENT it is an
   * allowlist (spec §6.7): the pin with its display name, the page count, and
   * a PDF URL signed per read. No key, hash or URL of either HTML object is
   * ever serialized.
   */
  private async serializeContent(
    type: ArtifactType,
    rawContent: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (type !== ArtifactType.DOCUMENT) {
      return rawContent;
    }

    const { commentary, document } = parseArtifactContent(
      type,
      rawContent,
    ) as DocumentContent;
    return {
      ...(commentary !== undefined ? { commentary } : {}),
      document: await this.serializeDocument(document),
    };
  }

  private async serializeDocument(
    document: DocumentVersion,
  ): Promise<Record<string, unknown>> {
    const pin = await this.designSystems.resolve(
      document.designSystemId,
      document.designSystemVersion,
    );
    const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000);
    return {
      designSystemId: document.designSystemId,
      designSystemVersion: document.designSystemVersion,
      designSystemName: pin.name,
      pageCount: document.pageCount,
      pdfUrl: await getSignedUrl(document.pdfKey, SIGNED_URL_TTL_SECONDS),
      pdfUrlExpiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * A Document Version is one immutable document: an edit may change only the
   * title and the commentary (spec §6.4), and any other content key is a `400`
   * naming it.
   */
  private assertDocumentEditable(input: UpdateArtifactInput): void {
    const content =
      input.content !== undefined
        ? input.content
        : { ...input, title: undefined };
    for (const [key, value] of Object.entries(content)) {
      if (key === 'commentary' || value === undefined) continue;
      if (key === 'document') {
        const field = Object.keys(this.recordValue(value) ?? {})[0];
        throw new BadRequestException(
          `content.document${field ? `.${field}` : ''} cannot be edited`,
        );
      }
      throw new BadRequestException(`content.${key} cannot be edited`);
    }
  }

  private contentPatch(input: UpdateArtifactInput): Record<string, unknown> {
    const directContent =
      input.content !== undefined ? { ...input.content } : { ...input };
    delete directContent.title;
    delete directContent.content;

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
