import { WorkflowError } from '../engine/workflow.error';
import type { RunState, StepContext } from '../engine/workflow.types';
import { persistVersionStep } from './persist-version.step';

const makeStep = () => {
  const artifacts = { setVersionContent: jest.fn() };
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
  it('should write the content to the target version', async () => {
    mocks.artifacts.setVersionContent.mockResolvedValue(undefined);

    await expect(persistVersionStep(fixtures.state, ctx)).resolves.toEqual({});
    expect(mocks.artifacts.setVersionContent).toHaveBeenCalledWith(
      'artifact-1',
      1,
      { commentary: 'Write more.' },
      { title: 'Writing more' },
    );
  });

  it('should pass the render slot through when a document was rendered', async () => {
    mocks.artifacts.setVersionContent.mockResolvedValue(undefined);
    const render = { pdfKey: 'carousels/artifact-1/v1.pdf', pageCount: 6 };

    await persistVersionStep({ ...fixtures.state, render }, ctx);

    expect(mocks.artifacts.setVersionContent).toHaveBeenCalledWith(
      'artifact-1',
      1,
      { commentary: 'Write more.' },
      { render, title: 'Writing more' },
    );
  });

  it('should omit the title when a refinement has not generated one', async () => {
    mocks.artifacts.setVersionContent.mockResolvedValue(undefined);
    const state = { ...fixtures.state, generatedTitle: undefined };

    await persistVersionStep(state, ctx);

    expect(mocks.artifacts.setVersionContent).toHaveBeenCalledWith(
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
    expect(mocks.artifacts.setVersionContent).not.toHaveBeenCalled();
  });

  it('should let a database write error propagate so it stays retryable', async () => {
    const outage = new Error('write concern failed');
    mocks.artifacts.setVersionContent.mockRejectedValue(outage);

    await expect(persistVersionStep(fixtures.state, ctx)).rejects.toBe(outage);
  });
});
