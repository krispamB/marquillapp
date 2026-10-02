import { ConflictException } from '@nestjs/common';

jest.mock(
  '../../database/schemas',
  () => ({
    ArtifactType: { POST: 'POST', POLL: 'POLL', DOCUMENT: 'DOCUMENT' },
  }),
  { virtual: true },
);

import { ArtifactDeletedError } from '../../artifact/artifact-deleted.error';
import { WorkflowError, toWorkflowError } from '../engine/workflow.error';
import type { RunState, StepContext } from '../engine/workflow.types';
import { persistVersionStep } from './persist-version.step';

const makeStep = () => {
  const artifacts = { promoteVersion: jest.fn() };
  const ctx = { artifacts } as unknown as StepContext;

  const state = {
    input: { artifactId: 'artifact-1', version: 1, type: 'POST' },
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

  it('should promote a DOCUMENT as the draft commentary and the uploaded Document Version', async () => {
    mocks.artifacts.promoteVersion.mockResolvedValue(undefined);
    const document = {
      designSystemId: 'margin',
      designSystemVersion: 2,
      sourceKey: 'artifacts/artifact-1/1/source.html',
      sourceSha256: 'a'.repeat(64),
      candidateKey: 'artifacts/artifact-1/1/candidate.html',
      candidateSha256: 'b'.repeat(64),
      pdfKey: 'artifacts/artifact-1/1/document.pdf',
      pageCount: 4,
    };
    const state = {
      input: { artifactId: 'artifact-1', version: 1, type: 'DOCUMENT' },
      generatedTitle: 'Three fixes',
      draft: { commentary: 'Swipe through.', candidate: '<html></html>' },
      document,
    } as unknown as RunState;

    await persistVersionStep(state, ctx);

    expect(mocks.artifacts.promoteVersion).toHaveBeenCalledWith(
      'artifact-1',
      1,
      { commentary: 'Swipe through.', document },
      { title: 'Three fixes' },
    );
  });

  it('should fail terminally when a DOCUMENT reaches it without a Document Version', async () => {
    const state = {
      input: { artifactId: 'artifact-1', version: 1, type: 'DOCUMENT' },
      draft: { commentary: 'Swipe through.', candidate: '<html></html>' },
    } as unknown as RunState;

    await expect(persistVersionStep(state, ctx)).rejects.toMatchObject({
      retryable: false,
    });
    expect(mocks.artifacts.promoteVersion).not.toHaveBeenCalled();
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
