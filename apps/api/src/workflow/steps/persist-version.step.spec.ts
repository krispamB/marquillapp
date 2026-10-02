import { ConflictException } from '@nestjs/common';
import { ArtifactDeletedError } from '../../artifact/artifact-deleted.error';
import { WorkflowError, toWorkflowError } from '../engine/workflow.error';
import type { RunState, StepContext } from '../engine/workflow.types';
import { persistVersionStep } from './persist-version.step';

const makeStep = () => {
  const artifacts = { promoteVersion: jest.fn() };
  const ctx = { artifacts } as unknown as StepContext;

  const state = {
    input: { artifactId: 'artifact-1', version: 1 },
    generatedTitle: 'Writing more',
    content: { commentary: 'Write more.' },
  } as unknown as RunState;

  return { ctx, mocks: { artifacts }, fixtures: { state } };
};

let ctx: StepContext;
let mocks: ReturnType<typeof makeStep>['mocks'];
let fixtures: ReturnType<typeof makeStep>['fixtures'];

beforeEach(() => {
  jest.clearAllMocks();
  ({ ctx, mocks, fixtures } = makeStep());
});

describe('persistVersionStep', () => {
  it('should promote the target Attempt with its content', async () => {
    mocks.artifacts.promoteVersion.mockResolvedValue(undefined);

    await expect(persistVersionStep(fixtures.state, ctx)).resolves.toEqual({});
    expect(mocks.artifacts.promoteVersion).toHaveBeenCalledWith(
      'artifact-1',
      1,
      { commentary: 'Write more.' },
      { title: 'Writing more' },
    );
  });

  it('should pass the render slot through when a document was rendered', async () => {
    mocks.artifacts.promoteVersion.mockResolvedValue(undefined);
    const render = { pdfKey: 'carousels/artifact-1/v1.pdf', pageCount: 6 };

    await persistVersionStep({ ...fixtures.state, render }, ctx);

    expect(mocks.artifacts.promoteVersion).toHaveBeenCalledWith(
      'artifact-1',
      1,
      { commentary: 'Write more.' },
      { render, title: 'Writing more' },
    );
  });

  it('should omit the title when a refinement has not generated one', async () => {
    mocks.artifacts.promoteVersion.mockResolvedValue(undefined);
    const state = { ...fixtures.state, generatedTitle: undefined };

    await persistVersionStep(state, ctx);

    expect(mocks.artifacts.promoteVersion).toHaveBeenCalledWith(
      'artifact-1',
      1,
      { commentary: 'Write more.' },
      {},
    );
  });

  it('should fail terminally when the content slot was never filled', async () => {
    const state = { input: fixtures.state.input } as RunState;

    const error = await persistVersionStep(state, ctx).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(WorkflowError);
    expect(error).toMatchObject({ retryable: false });
    expect(mocks.artifacts.promoteVersion).not.toHaveBeenCalled();
  });

  it('should let a database write error propagate so it stays retryable', async () => {
    const outage = new Error('write concern failed');
    mocks.artifacts.promoteVersion.mockRejectedValue(outage);

    await expect(persistVersionStep(fixtures.state, ctx)).rejects.toBe(outage);
  });

  it('should fail terminally when the Attempt can no longer be promoted', async () => {
    mocks.artifacts.promoteVersion.mockRejectedValue(
      new ConflictException('Version 1 of artifact artifact-1 is FAILED'),
    );

    await expect(persistVersionStep(fixtures.state, ctx)).rejects.toMatchObject(
      {
        retryable: false,
        reason: 'Version 1 of artifact artifact-1 is FAILED',
      },
    );
  });

  it('should fail silently and terminally when the artifact was deleted mid-run', async () => {
    const deleted = new ArtifactDeletedError('artifact-1');
    mocks.artifacts.promoteVersion.mockRejectedValue(deleted);

    const error = await persistVersionStep(fixtures.state, ctx).catch(
      (e: unknown) => e,
    );

    expect(error).toBe(deleted);
    expect(toWorkflowError(error)).toMatchObject({
      retryable: false,
      silent: true,
    });
  });
});
