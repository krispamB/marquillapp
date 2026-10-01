import { NotFoundException } from '@nestjs/common';

jest.mock(
  '../../database/schemas',
  () => ({
    RunKind: { INITIAL: 'INITIAL', REFINE: 'REFINE' },
    VersionStatus: {
      GENERATING: 'GENERATING',
      READY: 'READY',
      FAILED: 'FAILED',
    },
  }),
  { virtual: true },
);

import { WorkflowError } from '../engine/workflow.error';
import type { RunState, StepContext } from '../engine/workflow.types';
import { resolveInputStep } from './resolve-input.step';

const makeStep = () => {
  const artifacts = {
    readVersion: jest.fn(),
    readRefineInput: jest.fn(),
  };
  const run = { getLatestCompletedResearch: jest.fn() };
  const ctx = { artifacts, run } as unknown as StepContext;

  const state = {
    input: { artifactId: 'artifact-1', version: 1, kind: 'INITIAL' },
  } as unknown as RunState;

  return { ctx, mocks: { artifacts, run }, fixtures: { state } };
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
});
