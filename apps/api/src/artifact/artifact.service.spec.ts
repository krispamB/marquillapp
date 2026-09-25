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
    CarouselTheme: {
      BOLD: 'bold',
      MINIMAL: 'minimal',
      EDITORIAL: 'editorial',
      GRADIENT: 'gradient',
    },
  }),
  { virtual: true },
);
jest.mock(
  '../s3',
  () => ({
    getSignedUrl: jest
      .fn()
      .mockResolvedValue('https://signed.example/document.pdf'),
  }),
  { virtual: true },
);

import { Types } from 'mongoose';
import {
  ArtifactType,
  CarouselTheme,
  VersionStatus,
} from 'src/database/schemas';
import { StylePreset } from '../agent/style-presets.config';
import type { ArtifactContent } from './schemas';
import { ArtifactService } from './artifact.service';

const makeService = () => {
  const artifactModel = {
    create: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
  };
  const postModel = { exists: jest.fn().mockResolvedValue(false) };
  const service = new ArtifactService(artifactModel as any, postModel as any);

  const userId = new Types.ObjectId().toString();
  const artifactId = new Types.ObjectId().toString();
  const fixtures = {
    userId,
    artifactId,
    createInput: {
      type: ArtifactType.POST,
      prompt: 'Write about TDD',
      withResearch: false,
    },
  };
  return { service, mocks: { artifactModel, postModel }, fixtures };
};

let service: ArtifactService;
let mocks: ReturnType<typeof makeService>['mocks'];
let fixtures: ReturnType<typeof makeService>['fixtures'];

beforeEach(() => {
  jest.clearAllMocks();
  ({ service, mocks, fixtures } = makeService());
});

describe('ArtifactService', () => {
  describe('createArtifact', () => {
    it('should create the artifact with version 1 GENERATING when given a prompt', async () => {
      const created = { _id: new Types.ObjectId() };
      mocks.artifactModel.create.mockResolvedValue(created);

      await expect(
        service.createArtifact(fixtures.userId, fixtures.createInput),
      ).resolves.toBe(created);

      expect(mocks.artifactModel.create).toHaveBeenCalledTimes(1);
      expect(mocks.artifactModel.create).toHaveBeenCalledWith({
        user: new Types.ObjectId(fixtures.userId),
        type: ArtifactType.POST,
        source: { prompt: 'Write about TDD', withResearch: false },
        currentVersion: 1,
        versions: [
          { version: 1, status: VersionStatus.GENERATING, content: {} },
        ],
      });
    });

    it('should stamp stylePreset onto the source when provided', async () => {
      mocks.artifactModel.create.mockResolvedValue({});

      await service.createArtifact(fixtures.userId, {
        ...fixtures.createInput,
        stylePreset: StylePreset.BOLD,
      });

      expect(mocks.artifactModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          source: {
            prompt: 'Write about TDD',
            withResearch: false,
            stylePreset: 'bold',
          },
        }),
      );
    });
  });

  describe('appendRefineVersion', () => {
    const readyArtifact = () => ({
      _id: fixtures.artifactId,
      type: ArtifactType.POST,
      currentVersion: 1,
      source: {
        prompt: 'Write about TDD',
        withResearch: true,
        stylePreset: StylePreset.EDUCATIONAL,
      },
      versions: [
        {
          version: 1,
          status: VersionStatus.READY,
          content: { commentary: 'The original post.' },
        },
      ],
    });

    it('should append a GENERATING version and move the head forward when refining a ready artifact', async () => {
      mocks.artifactModel.findOne.mockResolvedValue(readyArtifact());

      await expect(
        service.appendRefineVersion(
          fixtures.userId,
          fixtures.artifactId,
          'Make the hook sharper',
        ),
      ).resolves.toEqual({
        version: 2,
        type: ArtifactType.POST,
        prompt: 'Write about TDD',
        withResearch: true,
        stylePreset: StylePreset.EDUCATIONAL,
      });

      expect(mocks.artifactModel.findOne).toHaveBeenCalledWith({
        _id: fixtures.artifactId,
        user: expect.any(Types.ObjectId),
      });
      expect(mocks.artifactModel.updateOne).toHaveBeenCalledWith(
        {
          _id: fixtures.artifactId,
          user: expect.any(Types.ObjectId),
          currentVersion: 1,
        },
        {
          $set: { currentVersion: 2 },
          $push: {
            versions: {
              version: 2,
              status: VersionStatus.GENERATING,
              content: {},
              refineFeedback: 'Make the hook sharper',
            },
          },
        },
      );
    });

    it('should carry the document theme into the refine input when the user supplied one', async () => {
      mocks.artifactModel.findOne.mockResolvedValue({
        ...readyArtifact(),
        type: ArtifactType.DOCUMENT,
        source: {
          prompt: 'Build a carousel',
          withResearch: false,
          theme: CarouselTheme.MINIMAL,
        },
      });

      await expect(
        service.appendRefineVersion(
          fixtures.userId,
          fixtures.artifactId,
          'Use fewer words',
        ),
      ).resolves.toMatchObject({
        type: ArtifactType.DOCUMENT,
        prompt: 'Build a carousel',
        withResearch: false,
        theme: CarouselTheme.MINIMAL,
      });
    });

    it('should carry a model-selected document theme into the refine input when the source has none', async () => {
      mocks.artifactModel.findOne.mockResolvedValue({
        ...readyArtifact(),
        type: ArtifactType.DOCUMENT,
        source: {
          prompt: 'Build a carousel',
          withResearch: false,
        },
        versions: [
          {
            version: 1,
            status: VersionStatus.READY,
            content: {
              document: {
                templateId: CarouselTheme.GRADIENT,
                slides: [
                  { type: 'cover', fields: { title: 'A carousel' } },
                  { type: 'content', fields: { heading: 'A', body: 'B' } },
                ],
              },
            },
          },
        ],
      });

      await expect(
        service.appendRefineVersion(
          fixtures.userId,
          fixtures.artifactId,
          'Use fewer words',
        ),
      ).resolves.toMatchObject({ theme: CarouselTheme.GRADIENT });
    });

    it('should reject an unknown or soft-deleted artifact when appending a version', async () => {
      mocks.artifactModel.findOne.mockResolvedValue(null);

      await expect(
        service.appendRefineVersion(
          fixtures.userId,
          fixtures.artifactId,
          'Try again',
        ),
      ).rejects.toMatchObject({ name: 'NotFoundException' });

      mocks.artifactModel.findOne.mockResolvedValue({
        ...readyArtifact(),
        deletedAt: new Date(),
      });

      await expect(
        service.appendRefineVersion(
          fixtures.userId,
          fixtures.artifactId,
          'Try again',
        ),
      ).rejects.toMatchObject({ name: 'NotFoundException' });
      expect(mocks.artifactModel.updateOne).not.toHaveBeenCalled();
    });

    it('should reject a concurrent head change when appending a version', async () => {
      mocks.artifactModel.findOne.mockResolvedValue(readyArtifact());
      mocks.artifactModel.updateOne.mockResolvedValue({ matchedCount: 0 });

      await expect(
        service.appendRefineVersion(
          fixtures.userId,
          fixtures.artifactId,
          'Try again',
        ),
      ).rejects.toMatchObject({ name: 'ConflictException' });
    });

    it('should reject a refine when the current version is still generating', async () => {
      mocks.artifactModel.findOne.mockResolvedValue({
        ...readyArtifact(),
        versions: [
          {
            version: 1,
            status: VersionStatus.GENERATING,
            content: {},
          },
        ],
      });

      await expect(
        service.appendRefineVersion(
          fixtures.userId,
          fixtures.artifactId,
          'Try again',
        ),
      ).rejects.toMatchObject({ name: 'ConflictException' });
      expect(mocks.artifactModel.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('readRefineInput', () => {
    it('should return the prior version content and feedback when the target version is refining', async () => {
      mocks.artifactModel.findById.mockResolvedValue({
        _id: fixtures.artifactId,
        type: ArtifactType.POST,
        currentVersion: 2,
        versions: [
          {
            version: 1,
            status: VersionStatus.READY,
            content: { commentary: 'The original post.' },
          },
          {
            version: 2,
            status: VersionStatus.GENERATING,
            content: {},
            refineFeedback: 'Make the hook sharper',
          },
        ],
      });

      await expect(
        service.readRefineInput(fixtures.artifactId, 2),
      ).resolves.toEqual({
        priorContent: { commentary: 'The original post.' },
        feedback: 'Make the hook sharper',
      });
    });

    it('should reject when the target has no usable prior version for refinement', async () => {
      mocks.artifactModel.findById.mockResolvedValue({
        _id: fixtures.artifactId,
        type: ArtifactType.POST,
        currentVersion: 2,
        versions: [
          {
            version: 2,
            status: VersionStatus.GENERATING,
            content: {},
            refineFeedback: 'Try again',
          },
        ],
      });

      await expect(
        service.readRefineInput(fixtures.artifactId, 2),
      ).rejects.toMatchObject({ name: 'NotFoundException' });
    });

    it('should skip failed versions when finding the latest earlier usable content', async () => {
      mocks.artifactModel.findById.mockResolvedValue({
        _id: fixtures.artifactId,
        type: ArtifactType.POST,
        currentVersion: 3,
        versions: [
          {
            version: 1,
            status: VersionStatus.READY,
            content: { commentary: 'The original post.' },
          },
          {
            version: 2,
            status: VersionStatus.FAILED,
            content: {},
            failureReason: 'generation failed',
            refineFeedback: 'Make the hook sharper',
          },
          {
            version: 3,
            status: VersionStatus.GENERATING,
            content: {},
            refineFeedback: 'Try a more direct opening',
          },
        ],
      });

      await expect(
        service.readRefineInput(fixtures.artifactId, 3),
      ).resolves.toEqual({
        priorContent: { commentary: 'The original post.' },
        feedback: 'Try a more direct opening',
      });
    });
  });

  describe('setVersionContent', () => {
    const generatingArtifact = () => ({
      _id: fixtures.artifactId,
      type: ArtifactType.POST,
      versions: [{ version: 1, status: VersionStatus.GENERATING, content: {} }],
    });

    const generatingDocument = () => ({
      _id: fixtures.artifactId,
      type: ArtifactType.DOCUMENT,
      versions: [{ version: 1, status: VersionStatus.GENERATING, content: {} }],
    });

    // The slides-only shape GENERATE writes into state.content — no pdfKey yet.
    const slidesOnlyDocument = (): ArtifactContent => ({
      document: {
        templateId: CarouselTheme.MINIMAL,
        slides: [
          { type: 'cover', fields: { title: 'A carousel' } },
          { type: 'content', fields: { heading: 'One', body: 'A point' } },
        ],
      },
    });

    it('should validate the content and flip the version to READY when the version exists', async () => {
      mocks.artifactModel.findById.mockResolvedValue(generatingArtifact());

      await service.setVersionContent(
        fixtures.artifactId,
        1,
        {
          commentary: 'A finished post 🎉',
        },
        { title: '  A finished artifact  ' },
      );

      expect(mocks.artifactModel.updateOne).toHaveBeenCalledWith(
        { _id: fixtures.artifactId, 'versions.version': 1 },
        {
          $set: {
            title: 'A finished artifact',
            'versions.$.content': { commentary: 'A finished post 🎉' },
            'versions.$.status': VersionStatus.READY,
          },
        },
      );
    });

    it('should preserve the artifact title when persisting a refinement version', async () => {
      mocks.artifactModel.findById.mockResolvedValue({
        ...generatingArtifact(),
        title: 'Manually edited title',
        currentVersion: 2,
        versions: [
          {
            version: 2,
            status: VersionStatus.GENERATING,
            content: {},
          },
        ],
      });

      await service.setVersionContent(
        fixtures.artifactId,
        2,
        { commentary: 'Refined post' },
        { title: 'Ignored generated title' },
      );

      expect(mocks.artifactModel.updateOne).toHaveBeenCalledWith(
        expect.anything(),
        {
          $set: {
            'versions.$.content': { commentary: 'Refined post' },
            'versions.$.status': VersionStatus.READY,
          },
        },
      );
    });

    it('should reject with a ZodError and not write when the commentary exceeds 3000 characters', async () => {
      mocks.artifactModel.findById.mockResolvedValue(generatingArtifact());

      await expect(
        service.setVersionContent(fixtures.artifactId, 1, {
          commentary: 'a'.repeat(3001),
        }),
      ).rejects.toMatchObject({ name: 'ZodError' });
      expect(mocks.artifactModel.updateOne).not.toHaveBeenCalled();
    });

    it('should ignore render when the artifact is not a DOCUMENT', async () => {
      mocks.artifactModel.findById.mockResolvedValue(generatingArtifact());

      await service.setVersionContent(
        fixtures.artifactId,
        1,
        { commentary: 'Plain post' },
        { render: { pdfKey: 'renders/x.pdf', pageCount: 5 } },
      );

      expect(mocks.artifactModel.updateOne).toHaveBeenCalledWith(
        expect.anything(),
        {
          $set: {
            'versions.$.content': { commentary: 'Plain post' },
            'versions.$.status': VersionStatus.READY,
          },
        },
      );
    });

    it('should fold the render pdfKey and pageCount into the document before flipping READY', async () => {
      mocks.artifactModel.findById.mockResolvedValue(generatingDocument());

      await service.setVersionContent(
        fixtures.artifactId,
        1,
        slidesOnlyDocument(),
        {
          render: {
            pdfKey: 'artifacts/abc/1/document.pdf',
            pageCount: 2,
          },
        },
      );

      expect(mocks.artifactModel.updateOne).toHaveBeenCalledWith(
        { _id: fixtures.artifactId, 'versions.version': 1 },
        {
          $set: {
            'versions.$.content': {
              document: {
                templateId: 'minimal',
                slides: [
                  { type: 'cover', fields: { title: 'A carousel' } },
                  {
                    type: 'content',
                    fields: { heading: 'One', body: 'A point' },
                  },
                ],
                pdfKey: 'artifacts/abc/1/document.pdf',
                pageCount: 2,
              },
            },
            'versions.$.status': VersionStatus.READY,
          },
        },
      );
    });

    it('should refuse to flip a document READY when no render pdfKey has been produced', async () => {
      mocks.artifactModel.findById.mockResolvedValue(generatingDocument());

      // RENDER_PDF gates READY for documents; reaching PERSIST_VERSION without a
      // render is a wiring bug, never a healthy state to persist.
      await expect(
        service.setVersionContent(fixtures.artifactId, 1, slidesOnlyDocument()),
      ).rejects.toThrow(/pdfKey/i);
      expect(mocks.artifactModel.updateOne).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when the artifact does not exist', async () => {
      mocks.artifactModel.findById.mockResolvedValue(null);

      await expect(
        service.setVersionContent(fixtures.artifactId, 1, {
          commentary: 'x',
        }),
      ).rejects.toMatchObject({ name: 'NotFoundException' });
      expect(mocks.artifactModel.updateOne).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when the artifact is soft-deleted', async () => {
      mocks.artifactModel.findById.mockResolvedValue({
        ...generatingArtifact(),
        deletedAt: new Date(),
      });

      await expect(
        service.setVersionContent(fixtures.artifactId, 1, {
          commentary: 'x',
        }),
      ).rejects.toMatchObject({ name: 'NotFoundException' });
      expect(mocks.artifactModel.updateOne).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when the version does not exist on the artifact', async () => {
      mocks.artifactModel.findById.mockResolvedValue(generatingArtifact());

      await expect(
        service.setVersionContent(fixtures.artifactId, 2, {
          commentary: 'x',
        }),
      ).rejects.toMatchObject({ name: 'NotFoundException' });
      expect(mocks.artifactModel.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('failVersion', () => {
    const generatingArtifact = () => ({
      _id: fixtures.artifactId,
      type: ArtifactType.POST,
      versions: [{ version: 1, status: VersionStatus.GENERATING, content: {} }],
    });

    it('should flip the version to FAILED with the reason when the version exists', async () => {
      mocks.artifactModel.findById.mockResolvedValue(generatingArtifact());

      await service.failVersion(fixtures.artifactId, 1, 'insufficient credits');

      expect(mocks.artifactModel.updateOne).toHaveBeenCalledWith(
        { _id: fixtures.artifactId, 'versions.version': 1 },
        {
          $set: {
            'versions.$.status': VersionStatus.FAILED,
            'versions.$.failureReason': 'insufficient credits',
          },
        },
      );
    });

    it('should preserve the version rather than remove it, so the user can refine from it', async () => {
      mocks.artifactModel.findById.mockResolvedValue(generatingArtifact());

      await service.failVersion(fixtures.artifactId, 1, 'zod invalid');

      const [, update] = mocks.artifactModel.updateOne.mock.calls[0] as [
        unknown,
        { $set: Record<string, unknown> },
      ];
      expect(update.$set).not.toHaveProperty('versions.$.content');
    });

    it('should throw NotFoundException when the artifact does not exist', async () => {
      mocks.artifactModel.findById.mockResolvedValue(null);

      await expect(
        service.failVersion(fixtures.artifactId, 1, 'boom'),
      ).rejects.toMatchObject({ name: 'NotFoundException' });
      expect(mocks.artifactModel.updateOne).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when the version does not exist on the artifact', async () => {
      mocks.artifactModel.findById.mockResolvedValue(generatingArtifact());

      await expect(
        service.failVersion(fixtures.artifactId, 2, 'boom'),
      ).rejects.toMatchObject({ name: 'NotFoundException' });
      expect(mocks.artifactModel.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('readCurrent', () => {
    it('should return the current version content when the artifact exists', async () => {
      mocks.artifactModel.findById.mockResolvedValue({
        _id: fixtures.artifactId,
        type: ArtifactType.POST,
        currentVersion: 2,
        versions: [
          {
            version: 1,
            status: VersionStatus.READY,
            content: { commentary: 'old' },
          },
          {
            version: 2,
            status: VersionStatus.READY,
            content: { commentary: 'new' },
          },
        ],
      });

      await expect(service.readCurrent(fixtures.artifactId)).resolves.toEqual({
        type: ArtifactType.POST,
        version: 2,
        content: { commentary: 'new' },
      });
    });

    it('should throw NotFoundException when the artifact does not exist', async () => {
      mocks.artifactModel.findById.mockResolvedValue(null);

      await expect(
        service.readCurrent(fixtures.artifactId),
      ).rejects.toMatchObject({ name: 'NotFoundException' });
    });

    it('should throw NotFoundException when the artifact is soft-deleted', async () => {
      mocks.artifactModel.findById.mockResolvedValue({
        _id: fixtures.artifactId,
        type: ArtifactType.POST,
        currentVersion: 1,
        versions: [
          {
            version: 1,
            status: VersionStatus.READY,
            content: { commentary: 'x' },
          },
        ],
        deletedAt: new Date(),
      });

      await expect(
        service.readCurrent(fixtures.artifactId),
      ).rejects.toMatchObject({ name: 'NotFoundException' });
    });
  });
});
