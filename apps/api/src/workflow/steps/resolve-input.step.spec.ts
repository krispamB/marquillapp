import { NotFoundException } from '@nestjs/common';

jest.mock(
  '../../database/schemas',
  () => ({
    ArtifactType: { POST: 'POST', POLL: 'POLL', DOCUMENT: 'DOCUMENT' },
    RunKind: { INITIAL: 'INITIAL', REFINE: 'REFINE' },
    VersionStatus: {
      GENERATING: 'GENERATING',
      READY: 'READY',
      FAILED: 'FAILED',
    },
  }),
  { virtual: true },
);

jest.mock('../../design-system/prompt-fragment', () => ({
  renderPromptFragment: jest.fn(() => 'FRAGMENT'),
}));

import { WorkflowError } from '../engine/workflow.error';
import type { RunState, StepContext } from '../engine/workflow.types';
import { resolveInputStep } from './resolve-input.step';

const makeStep = () => {
  const artifacts = {
    readVersion: jest.fn(),
    readRefineInput: jest.fn(),
  };
  const run = { getLatestCompletedResearch: jest.fn() };
  const designSystems = { resolve: jest.fn() };
  const logger = { error: jest.fn() };
  const ctx = {
    artifacts,
    run,
    designSystems,
    logger,
  } as unknown as StepContext;

  const state = {
    input: {
      artifactId: 'artifact-1',
      version: 1,
      kind: 'INITIAL',
      type: 'POST',
    },
  } as unknown as RunState;

  const definition = { id: 'margin', version: 2 };
  const documentState = {
    input: {
      artifactId: 'artifact-1',
      version: 1,
      kind: 'INITIAL',
      type: 'DOCUMENT',
      designSystem: { id: 'margin', version: 2 },
    },
  } as unknown as RunState;

  return {
    ctx,
    mocks: { artifacts, run, designSystems, logger },
    fixtures: { state, documentState, definition },
  };
};

let ctx: StepContext;
let mocks: ReturnType<typeof makeStep>['mocks'];
let fixtures: ReturnType<typeof makeStep>['fixtures'];

beforeEach(() => {
  jest.clearAllMocks();
  ({ ctx, mocks, fixtures } = makeStep());
});

describe('resolveInputStep', () => {
  it('should return an empty patch when the target Attempt is GENERATING', async () => {
    mocks.artifacts.readVersion.mockResolvedValue({
      version: 1,
      status: 'GENERATING',
    });

    await expect(resolveInputStep(fixtures.state, ctx)).resolves.toEqual({});
    expect(mocks.artifacts.readVersion).toHaveBeenCalledWith('artifact-1', 1);
  });

  it('should continue when a replay finds the target already READY', async () => {
    mocks.artifacts.readVersion.mockResolvedValue({
      version: 1,
      status: 'READY',
    });

    await expect(resolveInputStep(fixtures.state, ctx)).resolves.toEqual({});
  });

  it('should fail terminally when the artifact does not exist', async () => {
    mocks.artifacts.readVersion.mockRejectedValue(
      new NotFoundException('Artifact artifact-1 not found'),
    );

    await expect(resolveInputStep(fixtures.state, ctx)).rejects.toMatchObject({
      retryable: false,
      reason: 'Artifact artifact-1 not found',
    });
  });

  it('should fail terminally when the target Attempt already FAILED', async () => {
    mocks.artifacts.readVersion.mockResolvedValue({
      version: 1,
      status: 'FAILED',
    });

    const error = await resolveInputStep(fixtures.state, ctx).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(WorkflowError);
    expect(error).toMatchObject({ retryable: false });
    expect((error as WorkflowError).reason).toContain('never resumed');
  });

  it('should rethrow an unreachable-database error so it stays retryable', async () => {
    const outage = new Error('connection timed out');
    mocks.artifacts.readVersion.mockRejectedValue(outage);

    await expect(resolveInputStep(fixtures.state, ctx)).rejects.toBe(outage);
  });

  it('should seed prior content, feedback, and cached research when resolving a REFINE run', async () => {
    fixtures.state.input = {
      artifactId: 'artifact-1',
      version: 2,
      kind: 'REFINE',
    } as never;
    mocks.artifacts.readVersion.mockResolvedValue({
      version: 2,
      status: 'GENERATING',
    });
    mocks.artifacts.readRefineInput.mockResolvedValue({
      priorContent: { commentary: 'The original post.' },
      feedback: 'Make the hook sharper',
    });
    mocks.run.getLatestCompletedResearch.mockResolvedValue({
      findings: 'Cached findings',
      sources: [{ title: 'Source', url: 'https://example.com' }],
    });

    await expect(resolveInputStep(fixtures.state, ctx)).resolves.toEqual({
      refine: {
        priorContent: { commentary: 'The original post.' },
        feedback: 'Make the hook sharper',
      },
      research: {
        findings: 'Cached findings',
        sources: [{ title: 'Source', url: 'https://example.com' }],
      },
    });
    expect(mocks.artifacts.readRefineInput).toHaveBeenCalledWith(
      'artifact-1',
      2,
    );
    expect(mocks.run.getLatestCompletedResearch).toHaveBeenCalledWith(
      'artifact-1',
    );
  });

  it('should leave the research slot empty when no completed run has cached research for a REFINE run', async () => {
    fixtures.state.input = {
      artifactId: 'artifact-1',
      version: 2,
      kind: 'REFINE',
    } as never;
    mocks.artifacts.readVersion.mockResolvedValue({
      version: 2,
      status: 'GENERATING',
    });
    mocks.artifacts.readRefineInput.mockResolvedValue({
      priorContent: { commentary: 'The original post.' },
      feedback: 'Make the hook sharper',
    });
    mocks.run.getLatestCompletedResearch.mockResolvedValue(undefined);

    await expect(resolveInputStep(fixtures.state, ctx)).resolves.toEqual({
      refine: {
        priorContent: { commentary: 'The original post.' },
        feedback: 'Make the hook sharper',
      },
    });
  });

  describe('for a DOCUMENT run', () => {
    beforeEach(() => {
      mocks.artifacts.readVersion.mockResolvedValue({
        version: 1,
        status: 'GENERATING',
      });
    });

    it('should load the pinned definition and its fragment when the pin resolves', async () => {
      mocks.designSystems.resolve.mockResolvedValue({
        contract: 1,
        definition: fixtures.definition,
      });

      await expect(
        resolveInputStep(fixtures.documentState, ctx),
      ).resolves.toEqual({
        designSystem: {
          definition: fixtures.definition,
          fragment: 'FRAGMENT',
        },
      });
      expect(mocks.designSystems.resolve).toHaveBeenCalledWith('margin', 2);
    });

    it('should fail terminally with design_system.unavailable and alert when the pin does not resolve', async () => {
      mocks.designSystems.resolve.mockRejectedValue(
        new NotFoundException('Design System margin v2 not found'),
      );

      await expect(
        resolveInputStep(fixtures.documentState, ctx),
      ).rejects.toMatchObject({
        retryable: false,
        code: 'design_system.unavailable',
      });
      expect(mocks.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('[ALERT design_system.unresolvable]'),
      );
    });

    it('should fail transiently when the pinned contract is not the supported one', async () => {
      mocks.designSystems.resolve.mockResolvedValue({
        contract: 2,
        definition: fixtures.definition,
      });

      await expect(
        resolveInputStep(fixtures.documentState, ctx),
      ).rejects.toMatchObject({
        retryable: true,
        code: 'design_system.unavailable',
      });
    });

    it('should rethrow a read failure so it stays retryable', async () => {
      const outage = new Error('connection reset');
      mocks.designSystems.resolve.mockRejectedValue(outage);

      await expect(resolveInputStep(fixtures.documentState, ctx)).rejects.toBe(
        outage,
      );
    });

    it('should fail terminally when the job carries no pin', async () => {
      const state = {
        input: { ...fixtures.documentState.input, designSystem: undefined },
      } as unknown as RunState;

      await expect(resolveInputStep(state, ctx)).rejects.toMatchObject({
        retryable: false,
      });
      expect(mocks.designSystems.resolve).not.toHaveBeenCalled();
    });
  });
});
