import type {
  AgentHooks,
  AgentTurnUsage,
  ResearchResult,
} from '../../agent/agent-runner.interface';
import { RunEventType } from '../engine/run-event.types';
import type { RunState, StepContext } from '../engine/workflow.types';
import { researchStep } from './research.step';

const turnUsage = (
  overrides: Partial<AgentTurnUsage> = {},
): AgentTurnUsage => ({
  promptTokens: 100,
  completionTokens: 50,
  totalTokens: 150,
  cost: 0.02,
  model: 'test/research-model',
  ...overrides,
});

const research: ResearchResult = {
  findings: 'Staff engineers who write get promoted.',
  sources: [
    { title: 'StaffEng', url: 'https://staffeng.com' },
    { title: 'Blog', url: 'https://blog.dev' },
  ],
};

const makeStep = () => {
  const agent = { generate: jest.fn(), research: jest.fn() };
  const meter = { record: jest.fn() };
  const run = { saveResearchContext: jest.fn().mockResolvedValue(undefined) };
  const emit = jest.fn();
  const ctx = { agent, meter, run, emit } as unknown as StepContext;

  const state = {
    input: {
      type: 'POST',
      prompt: 'Why staff engineers should write more',
      stylePreset: 'contrarian',
      artifactId: 'artifact-1',
      version: 1,
    },
  } as unknown as RunState;

  return { ctx, mocks: { agent, meter, run, emit }, fixtures: { state } };
};

let ctx: StepContext;
let mocks: ReturnType<typeof makeStep>['mocks'];
let fixtures: ReturnType<typeof makeStep>['fixtures'];

beforeEach(() => {
  jest.clearAllMocks();
  ({ ctx, mocks, fixtures } = makeStep());
});

describe('researchStep', () => {
  it('should patch the research slot with what the agent found', async () => {
    mocks.agent.research.mockResolvedValue(research);

    await expect(researchStep(fixtures.state, ctx)).resolves.toEqual({
      research,
    });
  });

  it('should call the agent with the prompt, type, and style preset', async () => {
    mocks.agent.research.mockResolvedValue(research);

    await researchStep(fixtures.state, ctx);

    expect(mocks.agent.research).toHaveBeenCalledWith(
      {
        prompt: 'Why staff engineers should write more',
        type: 'POST',
        stylePreset: 'contrarian',
      },
      expect.anything(),
    );
  });

  it('should persist the research on the run record for a later refine', async () => {
    mocks.agent.research.mockResolvedValue(research);

    await researchStep(fixtures.state, ctx);

    expect(mocks.run.saveResearchContext).toHaveBeenCalledWith(research);
  });

  it('should record each LLM turn as an llm usage and each search as a web_search', async () => {
    mocks.agent.research.mockImplementation(
      (_input: unknown, hooks: AgentHooks) => {
        hooks.onUsage?.(turnUsage({ cost: 0.03 }));
        hooks.onToolCall?.({ name: 'searchWeb' });
        hooks.onUsage?.(turnUsage({ cost: 0.01 }));
        return Promise.resolve(research);
      },
    );

    await researchStep(fixtures.state, ctx);

    expect(mocks.meter.record).toHaveBeenCalledWith({
      kind: 'llm',
      amount: 0.03,
      detail: { model: 'test/research-model', totalTokens: 150 },
    });
    expect(mocks.meter.record).toHaveBeenCalledWith({
      kind: 'web_search',
      amount: 1,
    });
  });

  it('should emit a step.progress with the number of sources found', async () => {
    mocks.agent.research.mockResolvedValue(research);

    await researchStep(fixtures.state, ctx);

    expect(mocks.emit).toHaveBeenCalledWith({
      type: RunEventType.STEP_PROGRESS,
      data: { step: 'RESEARCH', sourcesFound: 2 },
    });
  });

  it('should let an agent error propagate for the engine to classify', async () => {
    const error = new Error('LLM transport failed');
    mocks.agent.research.mockRejectedValue(error);

    await expect(researchStep(fixtures.state, ctx)).rejects.toBe(error);
    expect(mocks.run.saveResearchContext).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
  });
});
