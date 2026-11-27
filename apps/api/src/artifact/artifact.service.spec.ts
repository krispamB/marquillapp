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
jest.mock(
  '../s3',
  () => ({
    getSignedUrl: jest
      .fn()
      .mockResolvedValue('https://signed.example/document.pdf'),
  }),
  { virtual: true },
);
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

import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ArtifactType, VersionStatus } from 'src/database/schemas';
import { StylePreset } from '../agent/style-presets.config';
import type { ArtifactContent } from './schemas';
import { ArtifactService } from './artifact.service';
import { ArtifactDeletedError } from './artifact-deleted.error';
import { FailureCode } from '../workflow/workflow.constants';

const makeService = () => {
  const artifactModel = {
    create: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
  };
  const postModel = { exists: jest.fn().mockResolvedValue(false) };
  const workflowRuns = { findRunsForVersions: jest.fn().mockResolvedValue([]) };
  const designSystems = { resolve: jest.fn(), pinForRefine: jest.fn() };
  const service = new ArtifactService(
    artifactModel as any,
    postModel as any,
    workflowRuns as any,
    designSystems as any,
  );

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
  return {
    service,
    mocks: { artifactModel, postModel, designSystems },
    fixtures,
  };
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
    it('should create a content-less v1 Attempt and no Current Version when given a prompt', async () => {
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
        versions: [{ version: 1, status: VersionStatus.GENERATING }],
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

    it("should record a requested Design System on a new DOCUMENT's source", async () => {
      mocks.artifactModel.create.mockResolvedValue({});

      await service.createArtifact(fixtures.userId, {
        type: ArtifactType.DOCUMENT,
        prompt: 'Three fixes',
        withResearch: false,
        designSystemId: 'schematic',
      });

      expect(mocks.artifactModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          source: {
            prompt: 'Three fixes',
            withResearch: false,
            designSystemId: 'schematic',
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

    const refine = () =>
      service.appendRefineVersion(
        fixtures.userId,
        fixtures.artifactId,
        'Make the hook sharper',
      );

    it('should append a GENERATING Attempt without moving the Current Version when refining', async () => {
      mocks.artifactModel.findOne.mockResolvedValue(readyArtifact());

      await expect(refine()).resolves.toEqual({
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
          deletedAt: { $exists: false },
          currentVersion: 1,
          'versions.status': { $ne: VersionStatus.GENERATING },
          'versions.version': { $ne: 2 },
        },
        {
          $push: {
            versions: {
              version: 2,
              status: VersionStatus.GENERATING,
              refineFeedback: 'Make the hook sharper',
              parentVersion: 1,
            },
          },
        },
      );
    });

    it('should number the Attempt past a failed one when an earlier refine failed', async () => {
      mocks.artifactModel.findOne.mockResolvedValue({
        ...readyArtifact(),
        versions: [
          ...readyArtifact().versions,
          {
            version: 2,
            status: VersionStatus.FAILED,
            failureCode: FailureCode.INTERNAL,
            failureReason: 'boom',
          },
        ],
      });

      await expect(refine()).resolves.toMatchObject({ version: 3 });

      expect(mocks.artifactModel.updateOne).toHaveBeenCalledWith(
        expect.anything(),
        {
          $push: {
            versions: {
              version: 3,
              status: VersionStatus.GENERATING,
              refineFeedback: 'Make the hook sharper',
              parentVersion: 1,
            },
          },
        },
      );
    });

    describe('when the artifact is a DOCUMENT', () => {
      const document = {
        designSystemId: 'schematic',
        designSystemVersion: 1,
        sourceKey: 'artifacts/a/1/source.html',
        sourceSha256: 'a'.repeat(64),
        candidateKey: 'artifacts/a/1/candidate.html',
        candidateSha256: 'b'.repeat(64),
        pdfKey: 'artifacts/a/1/document.pdf',
        pageCount: 6,
      };
      const readyDocument = () => ({
        ...readyArtifact(),
        type: ArtifactType.DOCUMENT,
        source: { ...readyArtifact().source, designSystemId: 'margin' },
        versions: [
          {
            version: 1,
            status: VersionStatus.READY,
            content: { commentary: 'Swipe through.', document },
          },
        ],
      });

      beforeEach(() => {
        mocks.artifactModel.findOne.mockResolvedValue(readyDocument());
      });

      it("should pin the Attempt to the Current Version's exact pin by default", async () => {
        mocks.designSystems.pinForRefine.mockResolvedValue({
          id: 'schematic',
          version: 1,
        });

        await expect(refine()).resolves.toMatchObject({
          version: 2,
          type: ArtifactType.DOCUMENT,
          designSystem: { id: 'schematic', version: 1 },
        });
        expect(mocks.designSystems.pinForRefine).toHaveBeenCalledWith(
          { id: 'schematic', version: 1 },
          undefined,
        );
        expect(mocks.artifactModel.updateOne).toHaveBeenCalledWith(
          expect.anything(),
          {
            $push: {
              versions: expect.objectContaining({ parentVersion: 1 }),
            },
          },
        );
      });

      it('should pass an explicit switch through to the pin choice', async () => {
        mocks.designSystems.pinForRefine.mockResolvedValue({
          id: 'afterglow',
          version: 1,
        });

        await expect(
          service.appendRefineVersion(
            fixtures.userId,
            fixtures.artifactId,
            'Make it warmer',
            'afterglow',
          ),
        ).resolves.toMatchObject({
          designSystem: { id: 'afterglow', version: 1 },
        });
        expect(mocks.designSystems.pinForRefine).toHaveBeenCalledWith(
          { id: 'schematic', version: 1 },
          'afterglow',
        );
      });

      it('should append nothing when the pin is unavailable', async () => {
        mocks.designSystems.pinForRefine.mockRejectedValue(
          new ConflictException({ code: 'design_system.unavailable' }),
        );

        await expect(refine()).rejects.toMatchObject({
          response: { code: 'design_system.unavailable' },
        });
        expect(mocks.artifactModel.updateOne).not.toHaveBeenCalled();
      });
    });

    it('should reject a designSystemId with a 400 when the artifact is not a DOCUMENT', async () => {
      mocks.artifactModel.findOne.mockResolvedValue(readyArtifact());

      await expect(
        service.appendRefineVersion(
          fixtures.userId,
          fixtures.artifactId,
          'Make the hook sharper',
          'margin',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.artifactModel.updateOne).not.toHaveBeenCalled();
    });

    it('should reject an unknown or soft-deleted artifact when appending a version', async () => {
      mocks.artifactModel.findOne.mockResolvedValue(null);

      await expect(refine()).rejects.toMatchObject({
        name: 'NotFoundException',
      });

      mocks.artifactModel.findOne.mockResolvedValue({
        ...readyArtifact(),
        deletedAt: new Date(),
      });

      await expect(refine()).rejects.toMatchObject({
        name: 'NotFoundException',
      });
      expect(mocks.artifactModel.updateOne).not.toHaveBeenCalled();
    });

    it('should reject with a conflict when the conditional write matches nothing', async () => {
      mocks.artifactModel.findOne.mockResolvedValue(readyArtifact());
      mocks.artifactModel.updateOne.mockResolvedValue({ matchedCount: 0 });

      await expect(refine()).rejects.toMatchObject({
        name: 'ConflictException',
      });
    });

    it('should reject with a conflict when an Attempt is already in flight', async () => {
      mocks.artifactModel.findOne.mockResolvedValue({
        ...readyArtifact(),
        versions: [
          ...readyArtifact().versions,
          { version: 2, status: VersionStatus.GENERATING },
        ],
      });

      await expect(refine()).rejects.toMatchObject({
        name: 'ConflictException',
      });
      expect(mocks.artifactModel.updateOne).not.toHaveBeenCalled();
    });

    it('should reject with a conflict when there is no Current Version to refine', async () => {
      mocks.artifactModel.findOne.mockResolvedValue({
        ...readyArtifact(),
        currentVersion: undefined,
        versions: [
          {
            version: 1,
            status: VersionStatus.FAILED,
            failureCode: FailureCode.INTERNAL,
            failureReason: 'boom',
          },
        ],
      });

      await expect(refine()).rejects.toMatchObject({
        name: 'ConflictException',
      });
      expect(mocks.artifactModel.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('readRefineInput', () => {
    it('should return the parent version content and feedback when the target is refining', async () => {
      mocks.artifactModel.findById.mockResolvedValue({
        _id: fixtures.artifactId,
        type: ArtifactType.POST,
        currentVersion: 1,
        versions: [
          {
            version: 1,
            status: VersionStatus.READY,
            content: { commentary: 'The original post.' },
          },
          {
            version: 2,
            status: VersionStatus.GENERATING,
            refineFeedback: 'Make the hook sharper',
            parentVersion: 1,
          },
        ],
      });

      await expect(
        service.readRefineInput(fixtures.artifactId, 2),
      ).resolves.toEqual({
        priorContent: { commentary: 'The original post.' },
        feedback: 'Make the hook sharper',
        earlierFeedback: [],
        handEdited: false,
      });
    });

    it('should read the recorded parent rather than the latest earlier version when one failed', async () => {
      mocks.artifactModel.findById.mockResolvedValue({
        _id: fixtures.artifactId,
        type: ArtifactType.POST,
        currentVersion: 1,
        versions: [
          {
            version: 1,
            status: VersionStatus.READY,
            content: { commentary: 'The original post.' },
          },
          {
            version: 2,
            status: VersionStatus.FAILED,
            failureReason: 'generation failed',
            refineFeedback: 'Make the hook sharper',
            parentVersion: 1,
          },
          {
            version: 3,
            status: VersionStatus.GENERATING,
            refineFeedback: 'Try a more direct opening',
            parentVersion: 1,
          },
        ],
      });

      await expect(
        service.readRefineInput(fixtures.artifactId, 3),
      ).resolves.toEqual({
        priorContent: { commentary: 'The original post.' },
        feedback: 'Try a more direct opening',
        earlierFeedback: [],
        handEdited: false,
      });
    });

    // v1 -> v2 -> v3 (READY), plus a FAILED sibling and a READY non-ancestor.
    const refineChain = (): {
      _id: string;
      type: ArtifactType;
      currentVersion: number;
      versions: Array<Record<string, unknown>>;
    } => ({
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
          status: VersionStatus.READY,
          content: { commentary: 'Sharper hook.' },
          refineFeedback: 'Make the hook sharper',
          parentVersion: 1,
        },
        {
          version: 3,
          status: VersionStatus.READY,
          content: { commentary: 'Sharper hook, shorter.' },
          refineFeedback: 'Make it shorter',
          parentVersion: 2,
        },
        {
          version: 4,
          status: VersionStatus.FAILED,
          failureReason: 'generation failed',
          refineFeedback: 'Add emoji',
          parentVersion: 3,
        },
        {
          version: 5,
          status: VersionStatus.READY,
          content: { commentary: 'A branch off v1.' },
          refineFeedback: 'Go formal',
          parentVersion: 1,
        },
        {
          version: 6,
          status: VersionStatus.GENERATING,
          refineFeedback: 'Mention the launch date',
          parentVersion: 3,
        },
      ],
    });

    it('should return every request already applied to the base, oldest first', async () => {
      mocks.artifactModel.findById.mockResolvedValue(refineChain());

      await expect(
        service.readRefineInput(fixtures.artifactId, 6),
      ).resolves.toEqual({
        priorContent: { commentary: 'Sharper hook, shorter.' },
        feedback: 'Mention the launch date',
        earlierFeedback: ['Make the hook sharper', 'Make it shorter'],
        handEdited: false,
      });
    });

    it('should mark the input hand-edited only when the base itself was edited', async () => {
      const editedBase = refineChain();
      editedBase.versions[2] = {
        ...editedBase.versions[2],
        editedAt: new Date(),
      };
      mocks.artifactModel.findById.mockResolvedValue(editedBase);

      await expect(
        service.readRefineInput(fixtures.artifactId, 6),
      ).resolves.toMatchObject({ handEdited: true });

      const editedAncestor = refineChain();
      editedAncestor.versions[1] = {
        ...editedAncestor.versions[1],
        editedAt: new Date(),
      };
      mocks.artifactModel.findById.mockResolvedValue(editedAncestor);

      await expect(
        service.readRefineInput(fixtures.artifactId, 6),
      ).resolves.toMatchObject({ handEdited: false });
    });

    it('should stop at a missing or non-READY ancestor without throwing', async () => {
      const broken = refineChain();
      broken.versions[1] = { ...broken.versions[1], status: VersionStatus.FAILED };
      mocks.artifactModel.findById.mockResolvedValue(broken);

      await expect(
        service.readRefineInput(fixtures.artifactId, 6),
      ).resolves.toMatchObject({ earlierFeedback: ['Make it shorter'] });

      const missing = refineChain();
      missing.versions[2] = { ...missing.versions[2], parentVersion: 99 };
      mocks.artifactModel.findById.mockResolvedValue(missing);

      await expect(
        service.readRefineInput(fixtures.artifactId, 6),
      ).resolves.toMatchObject({ earlierFeedback: ['Make it shorter'] });
    });

    it('should stop at a cycle in the parent chain without throwing', async () => {
      const cyclic = refineChain();
      cyclic.versions[1] = { ...cyclic.versions[1], parentVersion: 3 };
      mocks.artifactModel.findById.mockResolvedValue(cyclic);

      await expect(
        service.readRefineInput(fixtures.artifactId, 6),
      ).resolves.toMatchObject({
        earlierFeedback: ['Make the hook sharper', 'Make it shorter'],
      });
    });

    it('should reject when the target has no READY parent version', async () => {
      mocks.artifactModel.findById.mockResolvedValue({
        _id: fixtures.artifactId,
        type: ArtifactType.POST,
        versions: [
          {
            version: 2,
            status: VersionStatus.GENERATING,
            refineFeedback: 'Try again',
            parentVersion: 1,
          },
        ],
      });

      await expect(
        service.readRefineInput(fixtures.artifactId, 2),
      ).rejects.toMatchObject({ name: 'NotFoundException' });
    });
  });

  describe('promoteVersion', () => {
    const generatingArtifact = () => ({
      _id: fixtures.artifactId,
      type: ArtifactType.POST,
      versions: [{ version: 1, status: VersionStatus.GENERATING }],
    });

    const generatingDocument = () => ({
      _id: fixtures.artifactId,
      type: ArtifactType.DOCUMENT,
      versions: [{ version: 1, status: VersionStatus.GENERATING }],
    });

    const promotionFilter = (version: number) => ({
      _id: fixtures.artifactId,
      deletedAt: { $exists: false },
      versions: {
        $elemMatch: { version, status: VersionStatus.GENERATING },
      },
    });

    // The §6.3 Document Version PERSIST_VERSION promotes.
    const documentContent = (
      sourceSha256 = 'a'.repeat(64),
    ): ArtifactContent => ({
      commentary: 'Swipe through.',
      document: {
        designSystemId: 'margin',
        designSystemVersion: 2,
        sourceKey: 'artifacts/abc/1/source.html',
        sourceSha256,
        candidateKey: 'artifacts/abc/1/candidate.html',
        candidateSha256: 'b'.repeat(64),
        pdfKey: 'artifacts/abc/1/document.pdf',
        pageCount: 4,
      },
    });

    it('should set the content, READY and currentVersion in one conditional write when the Attempt is GENERATING', async () => {
      mocks.artifactModel.findById.mockResolvedValue(generatingArtifact());

      await service.promoteVersion(
        fixtures.artifactId,
        1,
        {
          commentary: 'A finished post 🎉',
        },
        { title: '  A finished artifact  ' },
      );

      expect(mocks.artifactModel.updateOne).toHaveBeenCalledTimes(1);
      expect(mocks.artifactModel.updateOne).toHaveBeenCalledWith(
        promotionFilter(1),
        {
          $set: {
            title: 'A finished artifact',
            'versions.$.content': { commentary: 'A finished post 🎉' },
            'versions.$.status': VersionStatus.READY,
            currentVersion: 1,
          },
        },
      );
    });

    it('should preserve the artifact title when promoting a refinement', async () => {
      mocks.artifactModel.findById.mockResolvedValue({
        ...generatingArtifact(),
        title: 'Manually edited title',
        currentVersion: 1,
        versions: [
          { version: 1, status: VersionStatus.READY, content: {} },
          { version: 2, status: VersionStatus.GENERATING, parentVersion: 1 },
        ],
      });

      await service.promoteVersion(
        fixtures.artifactId,
        2,
        { commentary: 'Refined post' },
        { title: 'Ignored generated title' },
      );

      expect(mocks.artifactModel.updateOne).toHaveBeenCalledWith(
        promotionFilter(2),
        {
          $set: {
            'versions.$.content': { commentary: 'Refined post' },
            'versions.$.status': VersionStatus.READY,
            currentVersion: 2,
          },
        },
      );
    });

    it('should succeed without writing again when a replay finds the version already READY', async () => {
      mocks.artifactModel.findById
        .mockResolvedValueOnce(generatingArtifact())
        .mockResolvedValueOnce({
          ...generatingArtifact(),
          currentVersion: 1,
          versions: [
            {
              version: 1,
              status: VersionStatus.READY,
              content: { commentary: 'Plain post' },
            },
          ],
        });
      mocks.artifactModel.updateOne.mockResolvedValue({ matchedCount: 0 });

      await expect(
        service.promoteVersion(fixtures.artifactId, 1, {
          commentary: 'Plain post',
        }),
      ).resolves.toBeUndefined();
      expect(mocks.artifactModel.updateOne).toHaveBeenCalledTimes(1);
    });

    it('should throw a conflict when the Attempt already FAILED', async () => {
      mocks.artifactModel.findById
        .mockResolvedValueOnce(generatingArtifact())
        .mockResolvedValueOnce({
          ...generatingArtifact(),
          versions: [{ version: 1, status: VersionStatus.FAILED }],
        });
      mocks.artifactModel.updateOne.mockResolvedValue({ matchedCount: 0 });

      await expect(
        service.promoteVersion(fixtures.artifactId, 1, {
          commentary: 'Plain post',
        }),
      ).rejects.toMatchObject({ name: 'ConflictException' });
    });

    it('should throw ArtifactDeletedError when the artifact is deleted during the write', async () => {
      mocks.artifactModel.findById
        .mockResolvedValueOnce(generatingArtifact())
        .mockResolvedValueOnce({
          ...generatingArtifact(),
          deletedAt: new Date(),
        });
      mocks.artifactModel.updateOne.mockResolvedValue({ matchedCount: 0 });

      await expect(
        service.promoteVersion(fixtures.artifactId, 1, {
          commentary: 'Plain post',
        }),
      ).rejects.toBeInstanceOf(ArtifactDeletedError);
    });

    it('should throw ArtifactDeletedError without writing when the artifact is already soft-deleted', async () => {
      mocks.artifactModel.findById.mockResolvedValue({
        ...generatingArtifact(),
        deletedAt: new Date(),
      });

      await expect(
        service.promoteVersion(fixtures.artifactId, 1, {
          commentary: 'x',
        }),
      ).rejects.toBeInstanceOf(ArtifactDeletedError);
      expect(mocks.artifactModel.updateOne).not.toHaveBeenCalled();
    });

    it('should reject with a ZodError and not write when the commentary exceeds 3000 characters', async () => {
      mocks.artifactModel.findById.mockResolvedValue(generatingArtifact());

      await expect(
        service.promoteVersion(fixtures.artifactId, 1, {
          commentary: 'a'.repeat(3001),
        }),
      ).rejects.toMatchObject({ name: 'ZodError' });
      expect(mocks.artifactModel.updateOne).not.toHaveBeenCalled();
    });

    it('should ignore render when the artifact is not a DOCUMENT', async () => {
      mocks.artifactModel.findById.mockResolvedValue(generatingArtifact());

      await service.promoteVersion(
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
            currentVersion: 1,
          },
        },
      );
    });

    it('should promote a complete Document Version as it is', async () => {
      mocks.artifactModel.findById.mockResolvedValue(generatingDocument());

      await service.promoteVersion(fixtures.artifactId, 1, documentContent());

      expect(mocks.artifactModel.updateOne).toHaveBeenCalledWith(
        promotionFilter(1),
        {
          $set: {
            'versions.$.content': documentContent(),
            'versions.$.status': VersionStatus.READY,
            currentVersion: 1,
          },
        },
      );
    });

    it('should refuse to promote a document without its objects, the READY gate', async () => {
      mocks.artifactModel.findById.mockResolvedValue(generatingDocument());
      const content = documentContent() as {
        document: Record<string, unknown>;
      };
      delete content.document.pdfKey;

      await expect(
        service.promoteVersion(
          fixtures.artifactId,
          1,
          content as unknown as ArtifactContent,
        ),
      ).rejects.toThrow(/pdfKey/);
      expect(mocks.artifactModel.updateOne).not.toHaveBeenCalled();
    });

    it('should succeed on a replay that finds the same Document Source already READY', async () => {
      mocks.artifactModel.findById
        .mockResolvedValueOnce(generatingDocument())
        .mockResolvedValueOnce({
          ...generatingDocument(),
          currentVersion: 1,
          versions: [
            {
              version: 1,
              status: VersionStatus.READY,
              content: documentContent(),
            },
          ],
        });
      mocks.artifactModel.updateOne.mockResolvedValue({ matchedCount: 0 });

      await expect(
        service.promoteVersion(fixtures.artifactId, 1, documentContent()),
      ).resolves.toBeUndefined();
    });

    it('should throw a conflict on a replay that finds a different Document Source READY', async () => {
      mocks.artifactModel.findById
        .mockResolvedValueOnce(generatingDocument())
        .mockResolvedValueOnce({
          ...generatingDocument(),
          currentVersion: 1,
          versions: [
            {
              version: 1,
              status: VersionStatus.READY,
              content: documentContent(),
            },
          ],
        });
      mocks.artifactModel.updateOne.mockResolvedValue({ matchedCount: 0 });

      await expect(
        service.promoteVersion(
          fixtures.artifactId,
          1,
          documentContent('c'.repeat(64)),
        ),
      ).rejects.toMatchObject({ name: 'ConflictException' });
    });

    it('should throw NotFoundException when the artifact does not exist', async () => {
      mocks.artifactModel.findById.mockResolvedValue(null);

      await expect(
        service.promoteVersion(fixtures.artifactId, 1, {
          commentary: 'x',
        }),
      ).rejects.toMatchObject({ name: 'NotFoundException' });
      expect(mocks.artifactModel.updateOne).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when the version does not exist on the artifact', async () => {
      mocks.artifactModel.findById.mockResolvedValue(generatingArtifact());

      await expect(
        service.promoteVersion(fixtures.artifactId, 2, {
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
      versions: [{ version: 1, status: VersionStatus.GENERATING }],
    });

    it('should keep the Attempt as content-less FAILED history with its code and reason', async () => {
      mocks.artifactModel.findById.mockResolvedValue(generatingArtifact());

      await expect(
        service.failVersion(
          fixtures.artifactId,
          1,
          FailureCode.INTERNAL,
          'insufficient credits',
        ),
      ).resolves.toBe('FAILED');

      expect(mocks.artifactModel.updateOne).toHaveBeenCalledWith(
        {
          _id: fixtures.artifactId,
          versions: {
            $elemMatch: { version: 1, status: VersionStatus.GENERATING },
          },
        },
        {
          $set: {
            'versions.$.status': VersionStatus.FAILED,
            'versions.$.failureCode': FailureCode.INTERNAL,
            'versions.$.failureReason': 'insufficient credits',
          },
          $unset: { 'versions.$.content': '' },
        },
      );
    });

    it('should report NOT_GENERATING when the version is no longer GENERATING', async () => {
      mocks.artifactModel.findById.mockResolvedValue(generatingArtifact());
      mocks.artifactModel.updateOne.mockResolvedValue({ matchedCount: 0 });

      await expect(
        service.failVersion(fixtures.artifactId, 1, FailureCode.INTERNAL, 'x'),
      ).resolves.toBe('NOT_GENERATING');
    });

    it('should still fail the Attempt and report ARTIFACT_DELETED when the artifact was soft-deleted', async () => {
      mocks.artifactModel.findById.mockResolvedValue({
        ...generatingArtifact(),
        deletedAt: new Date(),
      });

      await expect(
        service.failVersion(fixtures.artifactId, 1, FailureCode.INTERNAL, 'x'),
      ).resolves.toBe('ARTIFACT_DELETED');
      expect(mocks.artifactModel.updateOne).toHaveBeenCalledTimes(1);
    });

    it('should throw NotFoundException when the artifact does not exist', async () => {
      mocks.artifactModel.findById.mockResolvedValue(null);

      await expect(
        service.failVersion(fixtures.artifactId, 1, FailureCode.INTERNAL, 'x'),
      ).rejects.toMatchObject({ name: 'NotFoundException' });
      expect(mocks.artifactModel.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('readVersion', () => {
    const artifact = () => ({
      _id: fixtures.artifactId,
      type: ArtifactType.POST,
      currentVersion: 1,
      versions: [
        {
          version: 1,
          status: VersionStatus.READY,
          content: { commentary: 'old' },
        },
        { version: 2, status: VersionStatus.GENERATING, parentVersion: 1 },
      ],
    });

    it('should return the type and status when the version exists', async () => {
      mocks.artifactModel.findById.mockResolvedValue(artifact());

      await expect(
        service.readVersion(fixtures.artifactId, 2),
      ).resolves.toEqual({
        type: ArtifactType.POST,
        version: 2,
        status: VersionStatus.GENERATING,
      });
    });

    it('should throw NotFoundException when the version does not exist', async () => {
      mocks.artifactModel.findById.mockResolvedValue(artifact());

      await expect(
        service.readVersion(fixtures.artifactId, 3),
      ).rejects.toMatchObject({ name: 'NotFoundException' });
    });

    it('should throw NotFoundException when the artifact does not exist', async () => {
      mocks.artifactModel.findById.mockResolvedValue(null);

      await expect(
        service.readVersion(fixtures.artifactId, 1),
      ).rejects.toMatchObject({ name: 'NotFoundException' });
    });

    it('should throw ArtifactDeletedError when the artifact is soft-deleted', async () => {
      mocks.artifactModel.findById.mockResolvedValue({
        ...artifact(),
        deletedAt: new Date(),
      });

      await expect(
        service.readVersion(fixtures.artifactId, 1),
      ).rejects.toBeInstanceOf(ArtifactDeletedError);
    });
  });
});
