/* eslint-disable @typescript-eslint/no-unsafe-assignment */

jest.mock(
  'src/database/schemas',
  () => ({
    Artifact: { name: 'Artifact' },
    Post: { name: 'Post' },
    PostStatus: { SCHEDULED: 'SCHEDULED', PUBLISHED: 'PUBLISHED' },
    ArtifactType: { POST: 'POST', POLL: 'POLL', DOCUMENT: 'DOCUMENT' },
    CarouselTheme: {
      BOLD: 'bold',
      MINIMAL: 'minimal',
      EDITORIAL: 'editorial',
      GRADIENT: 'gradient',
    },
    VersionStatus: {
      GENERATING: 'GENERATING',
      READY: 'READY',
      FAILED: 'FAILED',
    },
  }),
  { virtual: true },
);
jest.mock('../s3', () => ({ getSignedUrl: jest.fn() }), { virtual: true });

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
  return {
    service: new ArtifactService(artifactModel as never, postModel as never),
    artifactModel,
    postModel,
  };
};

const ids = {
  artifact: new Types.ObjectId(),
  user: new Types.ObjectId(),
  otherUser: new Types.ObjectId(),
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
    it('returns selected version content and signs document previews without exposing pdfKey', async () => {
      const { service, artifactModel } = makeService();
      const createdAt = new Date('2026-07-01T00:00:00.000Z');
      const editedAt = new Date('2026-07-02T00:00:00.000Z');
      const document = {
        commentary: 'A deck intro',
        document: {
          templateId: 'minimal',
          slides: [{ type: 'cover', fields: { title: 'Hello' } }],
          pdfKey: 'artifacts/deck/1/document.pdf',
          pageCount: 1,
        },
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
            templateId: 'minimal',
            slides: [{ type: 'cover', fields: { title: 'Hello' } }],
            pageCount: 1,
            pdfUrl: 'https://signed.example/document.pdf',
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
      expect(signedUrl).toHaveBeenCalledWith('artifacts/deck/1/document.pdf');
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
      expect(listPipeline).toContainEqual({
        $match: { '_currentVersion.status': VersionStatus.READY },
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

    it('returns summaries, current-version status, signed previews, and filter metadata without versions', async () => {
      const { service, artifactModel } = makeService();
      const firstSlide = { type: 'cover', fields: { title: 'Hello' } };
      const row = {
        _id: ids.artifact,
        type: ArtifactType.DOCUMENT,
        title: 'A deck',
        updatedAt: new Date('2026-07-02T00:00:00.000Z'),
        _currentVersion: {
          version: 1,
          status: VersionStatus.READY,
          content: {
            commentary: 'A deck intro',
            document: {
              templateId: 'minimal',
              slides: [firstSlide],
              pdfKey: 'artifacts/deck/1/document.pdf',
              pageCount: 1,
            },
          },
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
            updatedAt: row.updatedAt,
            preview: {
              commentary: 'A deck intro',
              firstSlide,
              pdfUrl: 'https://signed.example/document.pdf',
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
      expect(signedUrl).toHaveBeenCalledWith('artifacts/deck/1/document.pdf');
      expect(JSON.stringify(row)).not.toContain('versions');
    });

    it('should skip malformed artifacts when the current version is missing', async () => {
      const { service, artifactModel } = makeService();
      artifactModel.aggregate.mockImplementation((pipeline: unknown[]) => ({
        exec: jest
          .fn()
          .mockResolvedValue(
            pipeline.some((stage) => '$facet' in (stage as object))
              ? [
                  {
                    data: [
                      {
                        _id: ids.artifact,
                        type: ArtifactType.POST,
                        updatedAt: new Date('2026-07-02T00:00:00.000Z'),
                        _currentVersion: null,
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
      const currentVersionMatch = {
        $match: {
          $expr: {
            $gt: [
              {
                $size: {
                  $filter: {
                    input: { $ifNull: ['$versions', []] },
                    as: 'version',
                    cond: { $eq: ['$$version.version', '$currentVersion'] },
                  },
                },
              },
              0,
            ],
          },
        },
      };
      expect(listPipeline).toContainEqual(currentVersionMatch);

      const availableMonthsPipeline = artifactModel.aggregate.mock.calls[1][0];
      expect(availableMonthsPipeline).toContainEqual(currentVersionMatch);
      expect(artifactModel.distinct).toHaveBeenCalledWith(
        'type',
        expect.objectContaining(currentVersionMatch.$match),
      );
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

    it('preserves renderer-owned document metadata when the editor submits a document patch', async () => {
      const { service, artifactModel } = makeService();
      const artifact = readyPost({
        type: ArtifactType.DOCUMENT,
        versions: [
          {
            version: 1,
            status: VersionStatus.READY,
            content: {
              document: {
                templateId: 'minimal',
                slides: [
                  { type: 'cover', fields: { title: 'Original' } },
                  { type: 'content', fields: { heading: 'One', body: 'Body' } },
                ],
                pdfKey: 'artifacts/deck/1/document.pdf',
                pageCount: 1,
              },
            },
            createdAt: new Date(),
          },
        ],
      });
      artifactModel.findById.mockResolvedValue(artifact);
      artifactModel.findOneAndUpdate.mockResolvedValue(artifact);

      await service.updateArtifact(
        ids.user.toString(),
        ids.artifact.toString(),
        {
          content: {
            document: {
              slides: [
                { type: 'cover', fields: { title: 'Edited' } },
                { type: 'content', fields: { heading: 'One', body: 'Body' } },
              ],
              pdfKey: 'arbitrary/key.pdf',
              pageCount: 99,
            },
          },
        },
      );

      expect(artifactModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        {
          $set: expect.objectContaining({
            'versions.$.content': {
              document: {
                templateId: 'minimal',
                slides: [
                  { type: 'cover', fields: { title: 'Edited' } },
                  { type: 'content', fields: { heading: 'One', body: 'Body' } },
                ],
                pdfKey: 'artifacts/deck/1/document.pdf',
                pageCount: 1,
              },
            },
          }),
        },
        { new: true },
      );
    });
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
