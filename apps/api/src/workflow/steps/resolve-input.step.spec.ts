import { NotFoundException } from '@nestjs/common';

jest.mock(
  '../../database/schemas',
  () => ({ RunKind: { INITIAL: 'INITIAL', REFINE: 'REFINE' } }),
  { virtual: true },
);

import { WorkflowError } from '../engine/workflow.error';
import type { RunState, StepContext } from '../engine/workflow.types';
import { resolveInputStep } from './resolve-input.step';

const makeStep = () => {
  const artifacts = {
    readCurrent: jest.fn(),
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
  it('should return an empty patch when the target version exists', async () => {
    mocks.artifacts.readCurrent.mockResolvedValue({ version: 1 });

    await expect(resolveInputStep(fixtures.state, ctx)).resolves.toEqual({});
    expect(mocks.artifacts.readCurrent).toHaveBeenCalledWith('artifact-1');
  });

  it('should fail terminally when the artifact does not exist', async () => {
    mocks.artifacts.readCurrent.mockRejectedValue(
      new NotFoundException('Artifact artifact-1 not found'),
    );

    await expect(resolveInputStep(fixtures.state, ctx)).rejects.toMatchObject({
      retryable: false,
      reason: 'Artifact artifact-1 not found',
    });
  });

  it('should fail terminally when the current version is not the target version', async () => {
    mocks.artifacts.readCurrent.mockResolvedValue({ version: 2 });

    const error = await resolveInputStep(fixtures.state, ctx).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(WorkflowError);
    expect(error).toMatchObject({ retryable: false });
    expect((error as WorkflowError).reason).toContain('no version 1 to fill');
  });

  it('should rethrow an unreachable-database error so it stays retryable', async () => {
    const outage = new Error('connection timed out');
    mocks.artifacts.readCurrent.mockRejectedValue(outage);

    await expect(resolveInputStep(fixtures.state, ctx)).rejects.toBe(outage);
  });

  it('should seed prior content, feedback, and cached research when resolving a REFINE run', async () => {
    fixtures.state.input = {
      artifactId: 'artifact-1',
      version: 2,
      kind: 'REFINE',
    } as never;
    mocks.artifacts.readCurrent.mockResolvedValue({ version: 2 });
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
    mocks.artifacts.readCurrent.mockResolvedValue({ version: 2 });
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
