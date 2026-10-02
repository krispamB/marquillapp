jest.mock(
  'src/database/schemas',
  () => ({
    ArtifactType: { POST: 'POST', POLL: 'POLL', DOCUMENT: 'DOCUMENT' },
    VersionStatus: {
      GENERATING: 'GENERATING',
      READY: 'READY',
      FAILED: 'FAILED',
    },
    RunKind: { INITIAL: 'INITIAL', REFINE: 'REFINE' },
  }),
  { virtual: true },
);

jest.mock('./artifact.service', () => ({ ArtifactService: class {} }), {
  virtual: true,
});
jest.mock(
  'src/feature-gating/credit-meter.service',
  () => ({ CreditMeterService: class {} }),
  { virtual: true },
);
jest.mock(
  'src/feature-gating/feature-gating.service',
  () => ({ FeatureGatingService: class {} }),
  { virtual: true },
);
jest.mock(
  'src/workflow/workflow-run.service',
  () => ({ WorkflowRunService: class {} }),
  { virtual: true },
);
jest.mock(
  '../design-system/design-systems.service',
  () => ({ DesignSystemsService: class {} }),
  { virtual: true },
);
jest.mock('src/workflow/workflow.queue', () => ({ WorkflowQueue: class {} }), {
  virtual: true,
});

import { BadRequestException } from '@nestjs/common';
import { ArtifactType, RunKind } from 'src/database/schemas';
import { ArtifactGenerationService } from './artifact-generation.service';

describe('ArtifactGenerationService', () => {
  const makeService = () => {
    const artifactService = {
      createArtifact: jest.fn().mockResolvedValue({ _id: 'artifact123' }),
      appendRefineVersion: jest.fn().mockResolvedValue({
        version: 2,
        type: 'POST',
        prompt: 'why staff engineers write',
        withResearch: true,
      }),
    };
    const workflowRunService = {
      createRun: jest.fn().mockResolvedValue({ _id: 'run123' }),
    };
    const creditMeter = {
      assertBalance: jest.fn().mockResolvedValue(undefined),
    };
    const featureGating = {
      assertResearchAccess: jest.fn().mockResolvedValue(undefined),
    };
    const workflowQueue = {
      addArtifactRunJob: jest.fn().mockResolvedValue(undefined),
    };
    const designSystems = {
      getActive: jest.fn((id: string) => {
        if (id === 'retired') {
          throw new BadRequestException(
            `Design System "${id}" is not available`,
          );
        }
        return { id, version: id === 'margin' ? 2 : 1, name: 'Margin' };
      }),
    };

    const service = new ArtifactGenerationService(
      artifactService as any,
      workflowRunService as any,
      creditMeter as any,
      featureGating as any,
      workflowQueue as any,
      designSystems as any,
    );

    const dto = {
      type: ArtifactType.POST,
      prompt: 'why staff engineers write',
      withResearch: true,
    };

    return {
      service,
      mocks: {
        artifactService,
        workflowRunService,
        creditMeter,
        featureGating,
        workflowQueue,
        designSystems,
      },
      fixtures: { userId: 'user123', dto },
    };
  };

  /** The `BuildInput` the first `createRun` stored. */
  const storedInput = (): Record<string, unknown> =>
    (
      mocks.workflowRunService.createRun.mock.calls[0] as [
        { input: Record<string, unknown> },
      ]
    )[0].input;

  let service: ArtifactGenerationService;
  let mocks: ReturnType<typeof makeService>['mocks'];
  let fixtures: ReturnType<typeof makeService>['fixtures'];

  beforeEach(() => {
    jest.clearAllMocks();
    ({ service, mocks, fixtures } = makeService());
  });

  describe('launchInitialRun', () => {
    it('should reject a research run before creating or queueing anything when the tier disables research', async () => {
      mocks.featureGating.assertResearchAccess.mockRejectedValue(
        new Error('FEATURE_LIMIT_EXCEEDED'),
      );

      await expect(
        service.launchInitialRun(fixtures.userId, fixtures.dto),
      ).rejects.toThrow('FEATURE_LIMIT_EXCEEDED');

      expect(mocks.creditMeter.assertBalance).not.toHaveBeenCalled();
      expect(mocks.artifactService.createArtifact).not.toHaveBeenCalled();
      expect(mocks.workflowRunService.createRun).not.toHaveBeenCalled();
      expect(mocks.workflowQueue.addArtifactRunJob).not.toHaveBeenCalled();
    });

    it.each([ArtifactType.POST, ArtifactType.POLL, ArtifactType.DOCUMENT])(
      'should allow a paid research-enabled %s run to continue to the balance check',
      async (type) => {
        await service.launchInitialRun(fixtures.userId, {
          ...fixtures.dto,
          type,
        });

        expect(mocks.featureGating.assertResearchAccess).toHaveBeenCalledWith(
          fixtures.userId,
        );
        expect(mocks.creditMeter.assertBalance).toHaveBeenCalledWith(
          fixtures.userId,
        );
      },
    );

    it('should not require research access for a non-research run', async () => {
      await service.launchInitialRun(fixtures.userId, {
        ...fixtures.dto,
        withResearch: false,
      });

      expect(mocks.featureGating.assertResearchAccess).not.toHaveBeenCalled();
      expect(mocks.creditMeter.assertBalance).toHaveBeenCalledWith(
        fixtures.userId,
      );
    });

    it('should return the artifactId and runId when the run is launched', async () => {
      await expect(
        service.launchInitialRun(fixtures.userId, fixtures.dto),
      ).resolves.toEqual({ artifactId: 'artifact123', runId: 'run123' });
    });

    it('should pre-check the balance before creating anything', async () => {
      const order: string[] = [];
      mocks.creditMeter.assertBalance.mockImplementation(() => {
        order.push('assertBalance');
        return Promise.resolve();
      });
      mocks.artifactService.createArtifact.mockImplementation(() => {
        order.push('createArtifact');
        return Promise.resolve({ _id: 'artifact123' });
      });

      await service.launchInitialRun(fixtures.userId, fixtures.dto);

      expect(order).toEqual(['assertBalance', 'createArtifact']);
      expect(mocks.creditMeter.assertBalance).toHaveBeenCalledWith('user123');
    });

    it('should not create an artifact or enqueue when the balance check fails', async () => {
      mocks.creditMeter.assertBalance.mockRejectedValue(
        new Error('FEATURE_LIMIT_EXCEEDED'),
      );

      await expect(
        service.launchInitialRun(fixtures.userId, fixtures.dto),
      ).rejects.toThrow('FEATURE_LIMIT_EXCEEDED');

      expect(mocks.artifactService.createArtifact).not.toHaveBeenCalled();
      expect(mocks.workflowRunService.createRun).not.toHaveBeenCalled();
      expect(mocks.workflowQueue.addArtifactRunJob).not.toHaveBeenCalled();
    });

    it('should create the artifact from the dto', async () => {
      await service.launchInitialRun(fixtures.userId, {
        type: ArtifactType.DOCUMENT,
        prompt: 'deep modules',
        withResearch: false,
        stylePreset: 'educational' as any,
        designSystemId: 'schematic',
      });

      expect(mocks.artifactService.createArtifact).toHaveBeenCalledWith(
        'user123',
        {
          type: ArtifactType.DOCUMENT,
          prompt: 'deep modules',
          withResearch: false,
          stylePreset: 'educational',
          designSystemId: 'schematic',
        },
      );
    });

    it("should pin a DOCUMENT to the requested Design System's ACTIVE version", async () => {
      await service.launchInitialRun(fixtures.userId, {
        type: ArtifactType.DOCUMENT,
        prompt: 'deep modules',
        withResearch: false,
        designSystemId: 'schematic',
      });

      expect(mocks.designSystems.getActive).toHaveBeenCalledWith('schematic');
      expect(storedInput()).toMatchObject({
        designSystem: { id: 'schematic', version: 1 },
      });
    });

    it('should pin a DOCUMENT that names no Design System to the default', async () => {
      await service.launchInitialRun(fixtures.userId, {
        type: ArtifactType.DOCUMENT,
        prompt: 'deep modules',
        withResearch: false,
      });

      expect(mocks.designSystems.getActive).toHaveBeenCalledWith('margin');
      expect(storedInput()).toMatchObject({
        designSystem: { id: 'margin', version: 2 },
      });
    });

    it('should reject an unavailable Design System before any check, write or enqueue', async () => {
      await expect(
        service.launchInitialRun(fixtures.userId, {
          type: ArtifactType.DOCUMENT,
          prompt: 'deep modules',
          withResearch: true,
          designSystemId: 'retired',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.featureGating.assertResearchAccess).not.toHaveBeenCalled();
      expect(mocks.creditMeter.assertBalance).not.toHaveBeenCalled();
      expect(mocks.artifactService.createArtifact).not.toHaveBeenCalled();
      expect(mocks.workflowQueue.addArtifactRunJob).not.toHaveBeenCalled();
    });

    it('should reject a designSystemId on a type that is not a DOCUMENT', async () => {
      await expect(
        service.launchInitialRun(fixtures.userId, {
          ...fixtures.dto,
          designSystemId: 'margin',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.artifactService.createArtifact).not.toHaveBeenCalled();
    });

    it('should not pin a POST', async () => {
      await service.launchInitialRun(fixtures.userId, fixtures.dto);

      expect(mocks.designSystems.getActive).not.toHaveBeenCalled();
      expect(storedInput()).not.toHaveProperty('designSystem');
    });

    it('should persist an INITIAL run whose input targets version 1 of the new artifact', async () => {
      await service.launchInitialRun(fixtures.userId, fixtures.dto);

      expect(mocks.workflowRunService.createRun).toHaveBeenCalledWith({
        userId: 'user123',
        artifactId: 'artifact123',
        targetVersion: 1,
        kind: RunKind.INITIAL,
        input: {
          type: 'POST',
          prompt: 'why staff engineers write',
          withResearch: true,
          kind: RunKind.INITIAL,
          userId: 'user123',
          artifactId: 'artifact123',
          version: 1,
        },
      });
    });

    it('should enqueue the run keyed by the runId with the same input stored on the run', async () => {
      await service.launchInitialRun(fixtures.userId, fixtures.dto);

      const storedInput =
        mocks.workflowRunService.createRun.mock.calls[0][0].input;
      expect(mocks.workflowQueue.addArtifactRunJob).toHaveBeenCalledWith(
        'run123',
        storedInput,
      );
    });
  });

  describe('launchRefineRun', () => {
    it('should return the artifactId, new version, and runId when the refine run is launched', async () => {
      await expect(
        service.launchRefineRun(
          'user123',
          'artifact123',
          'Make the hook sharper',
        ),
      ).resolves.toEqual({
        artifactId: 'artifact123',
        version: 2,
        runId: 'run123',
      });
    });

    it('should assert balance before appending the new version when launching a refine', async () => {
      const order: string[] = [];
      mocks.creditMeter.assertBalance.mockImplementation(() => {
        order.push('assertBalance');
        return Promise.resolve();
      });
      mocks.artifactService.appendRefineVersion.mockImplementation(() => {
        order.push('appendRefineVersion');
        return Promise.resolve({
          version: 2,
          type: ArtifactType.POST,
          prompt: 'why staff engineers write',
          withResearch: true,
        });
      });

      await service.launchRefineRun(
        'user123',
        'artifact123',
        'Make the hook sharper',
      );

      expect(order).toEqual(['assertBalance', 'appendRefineVersion']);
      expect(mocks.creditMeter.assertBalance).toHaveBeenCalledWith('user123');
      expect(mocks.artifactService.appendRefineVersion).toHaveBeenCalledWith(
        'user123',
        'artifact123',
        'Make the hook sharper',
      );
    });

    it('should persist and enqueue a REFINE run when the version is appended', async () => {
      mocks.artifactService.appendRefineVersion.mockResolvedValue({
        version: 3,
        type: ArtifactType.POLL,
        prompt: 'deep modules',
        withResearch: true,
        stylePreset: 'educational',
      });

      await service.launchRefineRun(
        'user123',
        'artifact123',
        'Use a more concrete example',
      );

      expect(mocks.workflowRunService.createRun).toHaveBeenCalledWith({
        userId: 'user123',
        artifactId: 'artifact123',
        targetVersion: 3,
        kind: RunKind.REFINE,
        input: {
          type: ArtifactType.POLL,
          prompt: 'deep modules',
          withResearch: true,
          stylePreset: 'educational',
          kind: RunKind.REFINE,
          userId: 'user123',
          artifactId: 'artifact123',
          version: 3,
        },
      });

      const storedInput =
        mocks.workflowRunService.createRun.mock.calls[0][0].input;
      expect(mocks.workflowQueue.addArtifactRunJob).toHaveBeenCalledWith(
        'run123',
        storedInput,
      );
    });

    it('should not append or enqueue when the balance check fails for a refine', async () => {
      mocks.creditMeter.assertBalance.mockRejectedValue(
        new Error('FEATURE_LIMIT_EXCEEDED'),
      );

      await expect(
        service.launchRefineRun('user123', 'artifact123', 'Try again'),
      ).rejects.toThrow('FEATURE_LIMIT_EXCEEDED');

      expect(mocks.artifactService.appendRefineVersion).not.toHaveBeenCalled();
      expect(mocks.workflowRunService.createRun).not.toHaveBeenCalled();
      expect(mocks.workflowQueue.addArtifactRunJob).not.toHaveBeenCalled();
    });
  });
});
