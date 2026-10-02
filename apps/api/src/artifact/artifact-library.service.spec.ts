/* eslint-disable @typescript-eslint/no-unsafe-assignment */

jest.mock(
  'src/database/schemas',
  () => ({
    Artifact: { name: 'Artifact' },
    Post: { name: 'Post' },
    PostStatus: { SCHEDULED: 'SCHEDULED', PUBLISHED: 'PUBLISHED' },
    ArtifactType: { POST: 'POST', POLL: 'POLL', DOCUMENT: 'DOCUMENT' },
    VersionStatus: {
      GENERATING: 'GENERATING',
      READY: 'READY',
      FAILED: 'FAILED',
    },
  }),
  { virtual: true },
);
jest.mock('../s3', () => ({ getSignedUrl: jest.fn() }), { virtual: true });
jest.mock(
  '../design-system/design-systems.service',
  () => ({ DesignSystemsService: class {} }),
  { virtual: true },
);
jest.mock(
  'src/workflow/workflow-run.service',
  () => ({ WorkflowRunService: class {} }),
  { virtual: true },
);

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { ArtifactType, VersionStatus } from 'src/database/schemas';
import { getSignedUrl } from '../s3';
import { ArtifactService } from './artifact.service';

const signedUrl = getSignedUrl as jest.MockedFunction<typeof getSignedUrl>;

const makeService = () => {
  const artifactModel = {
    aggregate: jest.fn(),
    distinct: jest.fn(),
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
  };
  const postModel = { exists: jest.fn().mockResolvedValue(false) };
  const workflowRuns = { findRunsForVersions: jest.fn().mockResolvedValue([]) };
  const designSystems = {
    resolve: jest.fn().mockResolvedValue({ name: 'Margin' }),
  };
  return {
    service: new ArtifactService(
      artifactModel as never,
      postModel as never,
      workflowRuns as never,
      designSystems as never,
    ),
    artifactModel,
    postModel,
    workflowRuns,
    designSystems,
  };
};

/** A stored §6.3 Document Version, every key and hash included. */
const storedDocument = (overrides: Record<string, unknown> = {}) => ({
  designSystemId: 'margin',
  designSystemVersion: 2,
  sourceKey: 'artifacts/deck/1/source.html',
  sourceSha256: 'a'.repeat(64),
  candidateKey: 'artifacts/deck/1/candidate.html',
  candidateSha256: 'b'.repeat(64),
  pdfKey: 'artifacts/deck/1/document.pdf',
  pageCount: 4,
  coverKey: 'artifacts/deck/1/cover.png',
  ...overrides,
});

const ids = {
  artifact: new Types.ObjectId(),
  user: new Types.ObjectId(),
  otherUser: new Types.ObjectId(),
  run: new Types.ObjectId().toString(),
};

const readyPost = (overrides: Record<string, unknown> = {}) => ({
  _id: ids.artifact,
  user: ids.user,
  type: ArtifactType.POST,
  title: 'A post',
  currentVersion: 1,
  versions: [
    {
      version: 1,
      status: VersionStatus.READY,
      content: { commentary: 'A finished post' },
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
    },
  ],
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  updatedAt: new Date('2026-07-02T00:00:00.000Z'),
  ...overrides,
});

describe('ArtifactService library API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    signedUrl.mockResolvedValue('https://signed.example/document.pdf');
  });

  describe('getArtifact', () => {
    it('should return the Current Version and report the in-flight Attempt when a refine is running', async () => {
      const { service, artifactModel, workflowRuns } = makeService();
      artifactModel.findById.mockResolvedValue(
        readyPost({
          versions: [
            ...readyPost().versions,
            {
              version: 2,
              status: VersionStatus.GENERATING,
              refineFeedback: 'Sharper',
              parentVersion: 1,
              createdAt: new Date('2026-07-03T00:00:00.000Z'),
            },
          ],
        }),
      );
      workflowRuns.findRunsForVersions.mockResolvedValue([
        { artifactId: ids.artifact.toString(), version: 2, runId: ids.run },
      ]);

      await expect(
        service.getArtifact(ids.user.toString(), ids.artifact.toString()),
      ).resolves.toMatchObject({
        currentVersion: 1,
        latestAttempt: {
          version: 2,
          status: VersionStatus.GENERATING,
          runId: ids.run,
        },
        version: 1,
        status: VersionStatus.READY,
        content: { commentary: 'A finished post' },
      });
      expect(workflowRuns.findRunsForVersions).toHaveBeenCalledWith([
        { artifactId: ids.artifact.toString(), version: 2 },
      ]);
    });

    it('should return the Current Version and report the failed Attempt when a refine failed', async () => {
      const { service, artifactModel, workflowRuns } = makeService();
      artifactModel.findById.mockResolvedValue(
        readyPost({
          versions: [
            ...readyPost().versions,
            {
              version: 2,
              status: VersionStatus.FAILED,
              refineFeedback: 'Sharper',
              parentVersion: 1,
              failureCode: 'internal',
              failureReason: 'The model timed out',
              createdAt: new Date('2026-07-03T00:00:00.000Z'),
            },
          ],
        }),
      );
      workflowRuns.findRunsForVersions.mockResolvedValue([
        { artifactId: ids.artifact.toString(), version: 2, runId: ids.run },
      ]);

      const detail = await service.getArtifact(
        ids.user.toString(),
        ids.artifact.toString(),
      );

      expect(detail).toMatchObject({
        currentVersion: 1,
        latestAttempt: {
          version: 2,
          status: VersionStatus.FAILED,
          failureCode: 'internal',
          failureReason: 'The model timed out',
          runId: ids.run,
        },
        version: 1,
        status: VersionStatus.READY,
        content: { commentary: 'A finished post' },
      });
      expect(detail).not.toHaveProperty('failureCode');
    });

    it('should omit latestAttempt without looking up a run when the newest version is the Current Version', async () => {
      const { service, artifactModel, workflowRuns } = makeService();
      artifactModel.findById.mockResolvedValue(readyPost());

      const detail = await service.getArtifact(
        ids.user.toString(),
        ids.artifact.toString(),
      );

      expect(detail).not.toHaveProperty('latestAttempt');
      expect(workflowRuns.findRunsForVersions).not.toHaveBeenCalled();
    });

    it('should return the latest Attempt with empty content when there is no Current Version', async () => {
      const { service, artifactModel, workflowRuns } = makeService();
      artifactModel.findById.mockResolvedValue(
        readyPost({
          currentVersion: undefined,
          versions: [
            {
              version: 1,
              status: VersionStatus.GENERATING,
              createdAt: new Date('2026-07-01T00:00:00.000Z'),
            },
          ],
        }),
      );
      workflowRuns.findRunsForVersions.mockResolvedValue([
        { artifactId: ids.artifact.toString(), version: 1, runId: ids.run },
      ]);

      const detail = await service.getArtifact(
        ids.user.toString(),
        ids.artifact.toString(),
      );

      expect(detail).toMatchObject({
        latestAttempt: {
          version: 1,
          status: VersionStatus.GENERATING,
          runId: ids.run,
        },
        version: 1,
        status: VersionStatus.GENERATING,
        content: {},
      });
      expect(detail).not.toHaveProperty('currentVersion');
    });

    it('should return empty content plus the failure when a FAILED version is read by number', async () => {
      const { service, artifactModel } = makeService();
      artifactModel.findById.mockResolvedValue(
        readyPost({
          currentVersion: 3,
          versions: [
            ...readyPost().versions,
            {
              version: 2,
              status: VersionStatus.FAILED,
              failureCode: 'document.truncated',
              failureReason: 'The model ran out of tokens',
              createdAt: new Date('2026-07-03T00:00:00.000Z'),
            },
            {
              version: 3,
              status: VersionStatus.READY,
              content: { commentary: 'The third one' },
              createdAt: new Date('2026-07-04T00:00:00.000Z'),
            },
          ],
        }),
      );

      const detail = await service.getArtifact(
        ids.user.toString(),
        ids.artifact.toString(),
        { version: 2, includeVersions: true },
      );

      expect(detail).toMatchObject({
        currentVersion: 3,
        version: 2,
        status: VersionStatus.FAILED,
        failureCode: 'document.truncated',
        failureReason: 'The model ran out of tokens',
        content: {},
      });
      expect(detail).not.toHaveProperty('latestAttempt');
      expect(detail.versions?.[1]).toEqual({
        version: 2,
        status: VersionStatus.FAILED,
        createdAt: new Date('2026-07-03T00:00:00.000Z'),
        failureCode: 'document.truncated',
        failureReason: 'The model ran out of tokens',
      });
    });

    it('should return empty content without a failure when a GENERATING version is read by number', async () => {
      const { service, artifactModel } = makeService();
      artifactModel.findById.mockResolvedValue(
        readyPost({
          versions: [
            ...readyPost().versions,
            {
              version: 2,
              status: VersionStatus.GENERATING,
              content: { commentary: 'half-written' },
              createdAt: new Date('2026-07-03T00:00:00.000Z'),
            },
          ],
        }),
      );

      const detail = await service.getArtifact(
        ids.user.toString(),
        ids.artifact.toString(),
        { version: 2 },
      );

      expect(detail).toMatchObject({
        version: 2,
        status: VersionStatus.GENERATING,
        content: {},
        latestAttempt: { version: 2, status: VersionStatus.GENERATING },
      });
      expect(detail).not.toHaveProperty('failureCode');
      expect(detail).not.toHaveProperty('failureReason');
    });

    it('should omit currentVersion when no version has become READY', async () => {
      const { service, artifactModel } = makeService();
      artifactModel.findById.mockResolvedValue(
        readyPost({
          currentVersion: undefined,
          versions: [
            {
              version: 1,
              status: VersionStatus.FAILED,
              failureCode: 'internal',
              failureReason: 'boom',
              createdAt: new Date('2026-07-01T00:00:00.000Z'),
            },
          ],
        }),
      );

      const detail = await service.getArtifact(
        ids.user.toString(),
        ids.artifact.toString(),
      );

      expect(detail).toMatchObject({
        version: 1,
        status: VersionStatus.FAILED,
        content: {},
      });
      expect(detail).not.toHaveProperty('currentVersion');
    });

    it('returns the DOCUMENT allowlist with the pin, its name and a signed PDF URL, and no HTML key or hash', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-03T00:00:00.000Z'));
      const { service, artifactModel, designSystems } = makeService();
      const createdAt = new Date('2026-07-01T00:00:00.000Z');
      const editedAt = new Date('2026-07-02T00:00:00.000Z');
      const document = {
        commentary: 'A deck intro',
        document: storedDocument(),
      };
      const artifact = {
        ...readyPost(),
        type: ArtifactType.DOCUMENT,
        title: 'A deck',
        versions: [
          {
            version: 1,
            status: VersionStatus.READY,
            content: document,
            createdAt,
            editedAt,
            refineFeedback: 'Make it sharper',
          },
        ],
      };
      artifactModel.findById.mockResolvedValue(artifact);

      await expect(
        service.getArtifact(ids.user.toString(), ids.artifact.toString(), {
          includeVersions: true,
        }),
      ).resolves.toEqual({
        id: ids.artifact.toString(),
        type: ArtifactType.DOCUMENT,
        title: 'A deck',
        currentVersion: 1,
        version: 1,
        status: VersionStatus.READY,
        updatedAt: artifact.updatedAt,
        content: {
          commentary: 'A deck intro',
          document: {
            designSystemId: 'margin',
            designSystemVersion: 2,
            designSystemName: 'Margin',
            pageCount: 4,
            pdfUrl: 'https://signed.example/document.pdf',
            pdfUrlExpiresAt: '2026-07-03T01:00:00.000Z',
          },
        },
        versions: [
          {
            version: 1,
            status: VersionStatus.READY,
            createdAt,
            editedAt,
            refineFeedback: 'Make it sharper',
          },
        ],
      });
      expect(signedUrl).toHaveBeenCalledWith(
        'artifacts/deck/1/document.pdf',
        3600,
      );
      expect(designSystems.resolve).toHaveBeenCalledWith('margin', 2);
      jest.useRealTimers();
    });

    it('allows a direct GET of a soft-deleted artifact while keeping ownership enforced', async () => {
      const { service, artifactModel } = makeService();
      artifactModel.findById.mockResolvedValue(
        readyPost({ deletedAt: new Date('2026-07-03T00:00:00.000Z') }),
      );

      await expect(
        service.getArtifact(ids.user.toString(), ids.artifact.toString()),
      ).resolves.toMatchObject({ id: ids.artifact.toString() });

      artifactModel.findById.mockResolvedValue(
        readyPost({ user: ids.otherUser }),
      );
      await expect(
        service.getArtifact(ids.user.toString(), ids.artifact.toString()),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('listArtifacts', () => {
    it('should search title and source prompt with a case-insensitive literal substring before pagination', async () => {
      const { service, artifactModel } = makeService();
      artifactModel.aggregate.mockImplementation((pipeline: unknown[]) => ({
        exec: jest
          .fn()
          .mockResolvedValue(
            pipeline.some((stage) => '$facet' in (stage as object))
              ? [{ data: [], metadata: [{ total: 41 }] }]
              : [],
          ),
      }));
      artifactModel.distinct.mockResolvedValue([]);

      await expect(
        service.listArtifacts(ids.user.toString(), {
          type: ArtifactType.POST,
          status: VersionStatus.READY,
          month: '2026-07',
          page: 2,
          search: '  Deploy.*Safely  ',
        }),
      ).resolves.toMatchObject({ page: 2, pages: 3 });

      type SearchListStage = {
        $match?: {
          type?: ArtifactType;
          updatedAt?: { $gte: Date; $lt: Date };
          $or?: Array<{ title?: RegExp; 'source.prompt'?: RegExp }>;
        };
        $facet?: { data: Array<Record<string, number>> };
      };
      const aggregateCalls = artifactModel.aggregate.mock
        .calls as unknown as Array<[SearchListStage[]]>;
      const listPipeline = aggregateCalls[0][0];
      const pageMatch = listPipeline[0].$match;
      if (!pageMatch?.$or) throw new Error('Expected search match stage');
      expect(pageMatch.type).toBe(ArtifactType.POST);
      expect(pageMatch.updatedAt).toEqual({
        $gte: new Date(2026, 6, 1),
        $lt: new Date(2026, 7, 1),
      });
      expect(pageMatch.$or).toHaveLength(2);
      const titleSearch = pageMatch.$or[0].title;
      const promptSearch = pageMatch.$or[1]['source.prompt'];
      if (!titleSearch || !promptSearch) {
        throw new Error('Expected title and prompt search expressions');
      }
      expect(titleSearch).toBeInstanceOf(RegExp);
      expect(titleSearch.source).toBe('Deploy\\.\\*Safely');
      expect(titleSearch.flags).toContain('i');
      expect(promptSearch.source).toBe('Deploy\\.\\*Safely');
      expect(titleSearch.test('A DEPLOY.*SAFELY checklist')).toBe(true);
      expect(promptSearch.test('How to deploy.*safely today')).toBe(true);
      expect(titleSearch.test('Deploy carelessly')).toBe(false);
      expect(pageMatch).toMatchObject({
        'versions.status': { $ne: VersionStatus.GENERATING },
        currentVersion: { $ne: null },
      });
      const facet = listPipeline.find((stage) => stage.$facet)?.$facet;
      expect(facet?.data).toContainEqual({ $skip: 20 });
    });

    it('should preserve the unsearched list when the search query is whitespace only', async () => {
      const { service, artifactModel } = makeService();
      artifactModel.aggregate.mockImplementation((pipeline: unknown[]) => ({
        exec: jest
          .fn()
          .mockResolvedValue(
            pipeline.some((stage) => '$facet' in (stage as object))
              ? [{ data: [], metadata: [] }]
              : [],
          ),
      }));
      artifactModel.distinct.mockResolvedValue([]);

      await service.listArtifacts(ids.user.toString(), { search: '   ' });

      const aggregateCalls = artifactModel.aggregate.mock
        .calls as unknown as Array<
        [Array<{ $match?: Record<string, unknown> }>]
      >;
      expect(aggregateCalls[0][0][0].$match).not.toHaveProperty('$or');
    });

    it('should return summaries, latest-version status, signed previews, and filter metadata without versions', async () => {
      const { service, artifactModel } = makeService();
      const row = {
        _id: ids.artifact,
        type: ArtifactType.DOCUMENT,
        title: 'A deck',
        updatedAt: new Date('2026-07-02T00:00:00.000Z'),
        currentVersion: 1,
        _attemptInFlight: false,
        _latestVersion: { version: 1, status: VersionStatus.READY },
        _currentContent: {
          commentary: 'A deck intro',
          document: storedDocument(),
        },
      };
      artifactModel.aggregate.mockImplementation((pipeline: unknown[]) => ({
        exec: jest
          .fn()
          .mockResolvedValue(
            pipeline.some((stage) => '$facet' in (stage as object))
              ? [{ data: [row], metadata: [{ total: 1 }] }]
              : [{ month: '2026-07' }],
          ),
      }));
      artifactModel.distinct.mockResolvedValue([ArtifactType.DOCUMENT]);

      await expect(
        service.listArtifacts(ids.user.toString(), {
          month: '2026-07',
          page: 1,
        }),
      ).resolves.toEqual({
        data: [
          {
            id: ids.artifact.toString(),
            type: ArtifactType.DOCUMENT,
            title: 'A deck',
            status: VersionStatus.READY,
            currentVersion: 1,
            updatedAt: row.updatedAt,
            preview: {
              commentary: 'A deck intro',
              pdfUrl: 'https://signed.example/document.pdf',
              pageCount: 4,
              coverUrl: 'https://signed.example/document.pdf',
            },
          },
        ],
        filters: {
          availableMonths: ['2026-07'],
          types: [ArtifactType.DOCUMENT],
        },
        page: 1,
        pages: 1,
      });
      expect(signedUrl).toHaveBeenCalledWith(
        'artifacts/deck/1/document.pdf',
        3600,
      );
      expect(signedUrl).toHaveBeenCalledWith(
        'artifacts/deck/1/cover.png',
        3600,
      );
      expect(JSON.stringify(row)).not.toContain('versions');
    });

    it('should leave coverUrl out of a DOCUMENT preview when the cover capture failed', async () => {
      const { service, artifactModel } = makeService();
      const row = {
        _id: ids.artifact,
        type: ArtifactType.DOCUMENT,
        title: 'A deck',
        updatedAt: new Date('2026-07-02T00:00:00.000Z'),
        currentVersion: 1,
        _attemptInFlight: false,
        _latestVersion: { version: 1, status: VersionStatus.READY },
        _currentContent: {
          document: storedDocument({ coverKey: undefined }),
        },
      };
      artifactModel.aggregate.mockImplementation((pipeline: unknown[]) => ({
        exec: jest
          .fn()
          .mockResolvedValue(
            pipeline.some((stage) => '$facet' in (stage as object))
              ? [{ data: [row], metadata: [{ total: 1 }] }]
              : [],
          ),
      }));
      artifactModel.distinct.mockResolvedValue([]);

      const { data } = await service.listArtifacts(ids.user.toString());

      expect(data[0].preview).toEqual({
        pdfUrl: 'https://signed.example/document.pdf',
        pageCount: 4,
      });
      expect(JSON.stringify(data)).not.toContain('html');
    });

    it('should skip malformed artifacts when the artifact has no versions', async () => {
      const { service, artifactModel } = makeService();
      artifactModel.aggregate.mockImplementation((pipeline: unknown[]) => ({
        exec: jest.fn().mockResolvedValue(
          pipeline.some((stage) => '$facet' in (stage as object))
            ? [
                {
                  data: [
                    {
                      _id: ids.artifact,
                      type: ArtifactType.POST,
                      updatedAt: new Date('2026-07-02T00:00:00.000Z'),
                      _latestVersion: null,
                    },
                  ],
                  metadata: [{ total: 0 }],
                },
              ]
            : [],
        ),
      }));
      artifactModel.distinct.mockResolvedValue([]);

      await expect(
        service.listArtifacts(ids.user.toString()),
      ).resolves.toMatchObject({ data: [], page: 1, pages: 0 });

      const listPipeline = artifactModel.aggregate.mock.calls[0][0];
      const hasVersionMatch = {
        $match: {
          $expr: {
            $gt: [{ $size: { $ifNull: ['$versions', []] } }, 0],
          },
        },
      };
      expect(listPipeline).toContainEqual(hasVersionMatch);
      // An artifact without a Current Version still lists, by its newest Attempt.
      const facet = (
        listPipeline as Array<{ $facet?: { data: unknown[] } }>
      ).find((stage) => stage.$facet)?.$facet;
      expect(facet?.data).toContainEqual({
        $set: expect.objectContaining({
          _latestVersion: {
            $arrayElemAt: [{ $ifNull: ['$versions', []] }, -1],
          },
        }),
      });

      const availableMonthsPipeline = artifactModel.aggregate.mock.calls[1][0];
      expect(availableMonthsPipeline).toContainEqual(hasVersionMatch);
      expect(artifactModel.distinct).toHaveBeenCalledWith(
        'type',
        expect.objectContaining(hasVersionMatch.$match),
      );
    });
  });

  describe('listArtifacts status derivation', () => {
    const listWith = (
      artifactModel: ReturnType<typeof makeService>['artifactModel'],
      rows: unknown[],
    ) => {
      artifactModel.aggregate.mockImplementation((pipeline: unknown[]) => ({
        exec: jest
          .fn()
          .mockResolvedValue(
            pipeline.some((stage) => '$facet' in (stage as object))
              ? [{ data: rows, metadata: [{ total: rows.length }] }]
              : [],
          ),
      }));
      artifactModel.distinct.mockResolvedValue([]);
    };
    const row = (overrides: Record<string, unknown>) => ({
      _id: ids.artifact,
      type: ArtifactType.POST,
      title: 'A post',
      updatedAt: new Date('2026-07-02T00:00:00.000Z'),
      ...overrides,
    });

    it.each([
      [
        'GENERATING',
        {
          'versions.status': VersionStatus.GENERATING,
        },
      ],
      [
        'READY',
        {
          'versions.status': { $ne: VersionStatus.GENERATING },
          currentVersion: { $ne: null },
        },
      ],
      [
        'FAILED',
        {
          'versions.status': { $ne: VersionStatus.GENERATING },
          currentVersion: null,
        },
      ],
    ])(
      'should filter on the derived status in the first match stage when ?status=%s',
      async (status, expected) => {
        const { service, artifactModel } = makeService();
        listWith(artifactModel, []);

        await service.listArtifacts(ids.user.toString(), {
          status: status as VersionStatus,
          page: 3,
        });

        const aggregateCalls = artifactModel.aggregate.mock
          .calls as unknown as Array<[Array<Record<string, unknown>>]>;
        const listPipeline = aggregateCalls[0][0];
        // The filter precedes the facet, so total and pages count only matches.
        const facetIndex = listPipeline.findIndex((stage) => '$facet' in stage);
        expect(listPipeline[0]).toEqual({
          $match: {
            user: ids.user,
            deletedAt: { $exists: false },
            ...expected,
          },
        });
        expect(
          listPipeline.slice(facetIndex + 1).some((stage) => '$match' in stage),
        ).toBe(false);
      },
    );

    it('should report GENERATING and the in-flight Attempt with its run when a refine of the Current Version is running', async () => {
      const { service, artifactModel, workflowRuns } = makeService();
      listWith(artifactModel, [
        row({
          currentVersion: 1,
          _attemptInFlight: true,
          _latestVersion: { version: 2, status: VersionStatus.GENERATING },
          _currentContent: { commentary: 'The current post' },
        }),
      ]);
      workflowRuns.findRunsForVersions.mockResolvedValue([
        { artifactId: ids.artifact.toString(), version: 2, runId: ids.run },
      ]);

      const { data } = await service.listArtifacts(ids.user.toString());

      expect(data[0]).toMatchObject({
        status: VersionStatus.GENERATING,
        currentVersion: 1,
        latestAttempt: {
          version: 2,
          status: VersionStatus.GENERATING,
          runId: ids.run,
        },
        preview: { commentary: 'The current post' },
      });
      expect(workflowRuns.findRunsForVersions).toHaveBeenCalledWith([
        { artifactId: ids.artifact.toString(), version: 2 },
      ]);
    });

    it('should report READY with the failed Attempt when a refine failed after a Current Version', async () => {
      const { service, artifactModel } = makeService();
      listWith(artifactModel, [
        row({
          currentVersion: 1,
          _attemptInFlight: false,
          _latestVersion: {
            version: 2,
            status: VersionStatus.FAILED,
            failureCode: 'internal',
            failureReason: 'boom',
          },
          _currentContent: { commentary: 'The current post' },
        }),
      ]);

      const { data } = await service.listArtifacts(ids.user.toString());

      expect(data[0]).toMatchObject({
        status: VersionStatus.READY,
        currentVersion: 1,
        latestAttempt: {
          version: 2,
          status: VersionStatus.FAILED,
          failureCode: 'internal',
          failureReason: 'boom',
        },
        preview: { commentary: 'The current post' },
      });
      // No run record matched, so runId is omitted rather than invented.
      expect(data[0].latestAttempt).not.toHaveProperty('runId');
    });

    it('should report READY without latestAttempt when the newest version is the Current Version', async () => {
      const { service, artifactModel, workflowRuns } = makeService();
      listWith(artifactModel, [
        row({
          currentVersion: 2,
          _attemptInFlight: false,
          _latestVersion: { version: 2, status: VersionStatus.READY },
          _currentContent: { commentary: 'v2' },
        }),
      ]);

      const { data } = await service.listArtifacts(ids.user.toString());

      expect(data[0]).toMatchObject({
        status: VersionStatus.READY,
        currentVersion: 2,
      });
      expect(data[0]).not.toHaveProperty('latestAttempt');
      expect(workflowRuns.findRunsForVersions).not.toHaveBeenCalled();
    });

    it('should report GENERATING with an empty preview when the first version is still generating', async () => {
      const { service, artifactModel } = makeService();
      listWith(artifactModel, [
        row({
          _attemptInFlight: true,
          _latestVersion: { version: 1, status: VersionStatus.GENERATING },
        }),
      ]);

      const { data } = await service.listArtifacts(ids.user.toString());

      expect(data[0]).toMatchObject({
        status: VersionStatus.GENERATING,
        latestAttempt: { version: 1, status: VersionStatus.GENERATING },
        preview: {},
      });
      expect(data[0]).not.toHaveProperty('currentVersion');
    });

    it('should report FAILED when no version ever became READY', async () => {
      const { service, artifactModel } = makeService();
      listWith(artifactModel, [
        row({
          currentVersion: null,
          _attemptInFlight: false,
          _latestVersion: {
            version: 1,
            status: VersionStatus.FAILED,
            failureCode: 'internal',
            failureReason: 'boom',
          },
        }),
      ]);

      const { data } = await service.listArtifacts(ids.user.toString());

      expect(data[0]).toMatchObject({
        status: VersionStatus.FAILED,
        latestAttempt: { version: 1, status: VersionStatus.FAILED },
        preview: {},
      });
      expect(data[0]).not.toHaveProperty('currentVersion');
    });
  });

  describe('updateArtifact', () => {
    it('should normalize the title when it is non-empty and at most 100 characters', async () => {
      const { service, artifactModel } = makeService();
      const artifact = readyPost();
      artifactModel.findById.mockResolvedValue(artifact);
      artifactModel.findOneAndUpdate.mockResolvedValue({
        ...artifact,
        title: 'Renamed artifact',
      });

      await service.updateArtifact(
        ids.user.toString(),
        ids.artifact.toString(),
        { title: '  Renamed artifact  ' },
      );

      expect(artifactModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        {
          $set: expect.objectContaining({ title: 'Renamed artifact' }),
        },
        { new: true },
      );
    });

    it('should reject an edit with a conflict when a refine Attempt is in flight', async () => {
      const { service, artifactModel } = makeService();
      artifactModel.findById.mockResolvedValue(
        readyPost({
          versions: [
            ...readyPost().versions,
            { version: 2, status: VersionStatus.GENERATING, parentVersion: 1 },
          ],
        }),
      );

      await expect(
        service.updateArtifact(ids.user.toString(), ids.artifact.toString(), {
          commentary: 'Edited',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(artifactModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it.each(['   ', 'x'.repeat(101)])(
      'should reject the title when it is blank or oversized',
      async (title) => {
        const { service, artifactModel } = makeService();
        artifactModel.findById.mockResolvedValue(readyPost());

        await expect(
          service.updateArtifact(ids.user.toString(), ids.artifact.toString(), {
            title,
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(artifactModel.findOneAndUpdate).not.toHaveBeenCalled();
      },
    );

    it('rejects an in-place edit when the current version is pinned by a scheduled post', async () => {
      const { service, artifactModel, postModel } = makeService();
      artifactModel.findById.mockResolvedValue(readyPost());
      postModel.exists.mockResolvedValue(true);

      await expect(
        service.updateArtifact(ids.user.toString(), ids.artifact.toString(), {
          content: { commentary: 'Changed after approval' },
        }),
      ).rejects.toThrow('pinned by a scheduled or published post');
      expect(artifactModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('rejects an edit when scheduling advances the pin revision concurrently', async () => {
      const { service, artifactModel } = makeService();
      artifactModel.findById.mockResolvedValue(readyPost({ pinRevision: 2 }));
      artifactModel.findOneAndUpdate.mockResolvedValue(null);

      await expect(
        service.updateArtifact(ids.user.toString(), ids.artifact.toString(), {
          content: { commentary: 'Concurrent edit' },
        }),
      ).rejects.toThrow('changed before the edit could be saved');
      expect(artifactModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ pinRevision: 2 }),
        expect.anything(),
        { new: true },
      );
    });

    it('deep-merges and validates a partial content edit in the READY head without creating a version', async () => {
      const { service, artifactModel } = makeService();
      const artifact = readyPost();
      artifactModel.findById.mockResolvedValue(artifact);
      artifactModel.findOneAndUpdate.mockResolvedValue({
        ...artifact,
        versions: [
          {
            ...artifact.versions[0],
            content: { commentary: 'Edited post' },
            editedAt: expect.any(Date),
          },
        ],
      });

      await service.updateArtifact(
        ids.user.toString(),
        ids.artifact.toString(),
        {
          content: { commentary: 'Edited post' },
        },
      );

      expect(artifactModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: ids.artifact,
          user: ids.user,
          currentVersion: 1,
          $or: [{ pinRevision: 0 }, { pinRevision: { $exists: false } }],
          versions: {
            $elemMatch: { version: 1, status: VersionStatus.READY },
          },
        }),
        {
          $set: expect.objectContaining({
            'versions.$.content': { commentary: 'Edited post' },
            'versions.$.editedAt': expect.any(Date),
          }),
        },
        { new: true },
      );
    });

    it('rejects edits while the current version is GENERATING or FAILED', async () => {
      const { service, artifactModel } = makeService();
      artifactModel.findById.mockResolvedValue(
        readyPost({
          versions: [
            {
              version: 1,
              status: VersionStatus.GENERATING,
              content: {},
              createdAt: new Date(),
            },
          ],
        }),
      );

      await expect(
        service.updateArtifact(ids.user.toString(), ids.artifact.toString(), {
          content: { commentary: 'not yet' },
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(artifactModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    const readyDocument = () =>
      readyPost({
        type: ArtifactType.DOCUMENT,
        versions: [
          {
            version: 1,
            status: VersionStatus.READY,
            content: { commentary: 'Old intro', document: storedDocument() },
            createdAt: new Date(),
          },
        ],
      });

    it('edits only the commentary of a DOCUMENT and keeps its Document Version', async () => {
      const { service, artifactModel } = makeService();
      const artifact = readyDocument();
      artifactModel.findById.mockResolvedValue(artifact);
      artifactModel.findOneAndUpdate.mockResolvedValue(artifact);

      await service.updateArtifact(
        ids.user.toString(),
        ids.artifact.toString(),
        { title: 'Renamed', content: { commentary: 'New intro' } },
      );

      expect(artifactModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        {
          $set: expect.objectContaining({
            title: 'Renamed',
            'versions.$.content': {
              commentary: 'New intro',
              document: storedDocument(),
            },
          }),
        },
        { new: true },
      );
    });

    it.each([
      [
        { content: { document: { pdfKey: 'arbitrary/key.pdf' } } },
        'content.document.pdfKey',
      ],
      [
        { content: { document: { designSystemId: 'schematic' } } },
        'content.document.designSystemId',
      ],
      [{ document: { slides: [] } }, 'content.document.slides'],
      [{ content: { poll: {} } }, 'content.poll'],
    ])(
      'rejects a DOCUMENT edit of %j with a 400 naming the field',
      async (patch, field) => {
        const { service, artifactModel } = makeService();
        artifactModel.findById.mockResolvedValue(readyDocument());

        const error = await service
          .updateArtifact(ids.user.toString(), ids.artifact.toString(), patch)
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as Error).message).toContain(field);
        expect(artifactModel.findOneAndUpdate).not.toHaveBeenCalled();
      },
    );
  });

  describe('deleteArtifact', () => {
    it('soft-deletes an owned artifact without touching its versions', async () => {
      const { service, artifactModel } = makeService();
      artifactModel.findById.mockResolvedValue(readyPost());
      artifactModel.updateOne.mockResolvedValue({ matchedCount: 1 });

      await expect(
        service.deleteArtifact(ids.user.toString(), ids.artifact.toString()),
      ).resolves.toMatchObject({ id: ids.artifact.toString() });
      expect(artifactModel.updateOne).toHaveBeenCalledWith(
        {
          _id: ids.artifact,
          user: ids.user,
          deletedAt: { $exists: false },
        },
        { $set: { deletedAt: expect.any(Date) } },
      );
    });
  });
});
