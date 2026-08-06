import { ContentValidationError } from '../../agent/agent-runner.error';
import type {
  AgentHooks,
  AgentTurnUsage,
} from '../../agent/agent-runner.interface';
import { LLMError } from '../../llm/errors';
import { WorkflowError } from '../engine/workflow.error';
import type { RunState, StepContext } from '../engine/workflow.types';
import { generateStep } from './generate.step';

const turnUsage = (
  overrides: Partial<AgentTurnUsage> = {},
): AgentTurnUsage => ({
  promptTokens: 100,
  completionTokens: 50,
  totalTokens: 150,
  cost: 0.02,
  model: 'test/generation-model',
  ...overrides,
});

const makeStep = () => {
  const agent = { generate: jest.fn(), research: jest.fn() };
  const meter = { record: jest.fn() };
  const ctx = { agent, meter } as unknown as StepContext;

  const state = {
    input: {
      type: 'POST',
      prompt: 'Why staff engineers should write more',
      stylePreset: 'contrarian',
      artifactId: 'artifact-1',
      version: 1,
    },
  } as unknown as RunState;

  return { ctx, mocks: { agent, meter }, fixtures: { state } };
};

let ctx: StepContext;
let mocks: ReturnType<typeof makeStep>['mocks'];
let fixtures: ReturnType<typeof makeStep>['fixtures'];

beforeEach(() => {
  jest.clearAllMocks();
  ({ ctx, mocks, fixtures } = makeStep());
});

describe('generateStep', () => {
  it('should patch the content slot with what the agent generated', async () => {
    const content = { commentary: 'Write more.' };
    mocks.agent.generate.mockResolvedValue({ title: 'Writing more', content });

    await expect(generateStep(fixtures.state, ctx)).resolves.toEqual({
      generatedTitle: 'Writing more',
      content,
    });
  });

  it('should pass the research and refine slots through to the agent', async () => {
    mocks.agent.generate.mockResolvedValue({
      content: { commentary: 'ok' },
    });
    const research = { findings: 'findings', sources: [] };
    const refine = {
      priorContent: { commentary: 'old' },
      feedback: 'sharper',
    };

    await generateStep({ ...fixtures.state, research, refine }, ctx);

    expect(mocks.agent.generate).toHaveBeenCalledWith(
      {
        type: 'POST',
        prompt: 'Why staff engineers should write more',
        stylePreset: 'contrarian',
        theme: undefined,
        research,
        refine,
      },
      expect.anything(),
    );
  });

  it('should record every LLM turn against the meter', async () => {
    mocks.agent.generate.mockImplementation(
      (_input: unknown, hooks: AgentHooks) => {
        hooks.onUsage?.(turnUsage({ cost: 0.01 }));
        hooks.onUsage?.(turnUsage({ cost: 0.02 }));
        return Promise.resolve({ content: { commentary: 'ok' } });
      },
    );

    await generateStep(fixtures.state, ctx);

    expect(mocks.meter.record).toHaveBeenCalledTimes(2);
    expect(mocks.meter.record).toHaveBeenNthCalledWith(1, {
      kind: 'llm',
      amount: 0.01,
      detail: { model: 'test/generation-model', totalTokens: 150 },
    });
    expect(mocks.meter.record).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ amount: 0.02 }),
    );
  });

  it('should fail terminally when the content is invalid after the repair retry', async () => {
    const invalid = new ContentValidationError('commentary must not be empty');
    mocks.agent.generate.mockRejectedValue(invalid);

    const error = await generateStep(fixtures.state, ctx).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(WorkflowError);
    expect(error).toMatchObject({
      retryable: false,
      reason: 'commentary must not be empty',
    });
    expect((error as WorkflowError).cause).toBe(invalid);
  });

  it('should rethrow an LLM transport error untouched, so the engine reads its own classification', async () => {
    const transportError = new LLMError('rate limited', {
      retryable: true,
      statusCode: 429,
    });
    mocks.agent.generate.mockRejectedValue(transportError);

    await expect(generateStep(fixtures.state, ctx)).rejects.toBe(
      transportError,
    );
  });
});
