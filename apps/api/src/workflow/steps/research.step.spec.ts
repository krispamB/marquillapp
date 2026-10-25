import type {
  AgentHooks,
  AgentTurnUsage,
  ResearchResult,
} from '../../agent/agent-runner.interface';
import type { UsageRecord } from '../../feature-gating/credit-meter.constants';
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
  const run = {
    runId: 'run-1',
    saveResearchContext: jest.fn().mockResolvedValue(undefined),
    readResearchContext: jest.fn().mockResolvedValue(undefined),
    recordModelCall: jest.fn(),
  };
  const emit = jest.fn();
  // Late on the 25th in UTC, so a local-time date would read the 26th east of UTC.
  const runCreatedAt = new Date('2026-10-25T23:30:00Z');
  const ctx = {
    agent,
    meter,
    run,
    emit,
    runCreatedAt,
  } as unknown as StepContext;

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

  it('should call the agent with the prompt, type, style preset, and the run id as the session', async () => {
    mocks.agent.research.mockResolvedValue(research);

    await researchStep(fixtures.state, ctx);

    expect(mocks.agent.research).toHaveBeenCalledWith(
      {
        prompt: 'Why staff engineers should write more',
        type: 'POST',
        stylePreset: 'contrarian',
        today: '2026-10-25',
        sessionId: 'run-1',
      },
      expect.anything(),
    );
  });

  it("should date the research from the run's creation time when the wall clock has moved on", async () => {
    jest.useFakeTimers().setSystemTime(new Date('2027-03-01T12:00:00Z'));
    mocks.agent.research.mockResolvedValue(research);

    try {
      await researchStep(fixtures.state, ctx);
    } finally {
      jest.useRealTimers();
    }

    expect(mocks.agent.research).toHaveBeenCalledWith(
      expect.objectContaining({ today: '2026-10-25' }),
      expect.anything(),
    );
  });

  it('should persist the research on the run record for a later refine', async () => {
    mocks.agent.research.mockResolvedValue(research);

    await researchStep(fixtures.state, ctx);

    expect(mocks.run.saveResearchContext).toHaveBeenCalledWith(research, []);
  });

  it('should save the recorded usage alongside the research when research completes', async () => {
    mocks.agent.research.mockImplementation(
      (_input: unknown, hooks: AgentHooks) => {
        hooks.onUsage?.(turnUsage({ cost: 0.03 }));
        hooks.onToolCall?.({ name: 'searchWeb' });
        return Promise.resolve(research);
      },
    );

    await researchStep(fixtures.state, ctx);

    expect(mocks.run.saveResearchContext).toHaveBeenCalledWith(research, [
      {
        kind: 'llm',
        amount: 0.03,
        detail: { model: 'test/research-model', totalTokens: 150 },
      },
      { kind: 'web_search', amount: 1 },
    ]);
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

  it("should tally each LLM turn's usage on the run record", async () => {
    const first = turnUsage({ cost: 0.03, latencyMs: 2000 });
    const second = turnUsage({ cost: 0.01, reasoningTokens: 40 });
    mocks.agent.research.mockImplementation(
      (_input: unknown, hooks: AgentHooks) => {
        hooks.onUsage?.(first);
        hooks.onUsage?.(second);
        return Promise.resolve(research);
      },
    );

    await researchStep(fixtures.state, ctx);

    expect(mocks.run.recordModelCall).toHaveBeenCalledTimes(2);
    expect(mocks.run.recordModelCall).toHaveBeenNthCalledWith(1, first);
    expect(mocks.run.recordModelCall).toHaveBeenNthCalledWith(2, second);
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

  describe('when an earlier attempt already saved the research', () => {
    const savedUsage: UsageRecord[] = [
      {
        kind: 'llm',
        amount: 0.03,
        detail: { model: 'test/research-model', totalTokens: 150 },
      },
      { kind: 'web_search', amount: 1 },
      { kind: 'llm', amount: 0.01 },
    ];

    beforeEach(() => {
      mocks.run.readResearchContext.mockResolvedValue({
        research,
        usage: savedUsage,
      });
    });

    it('should return the saved research without calling the agent when research was saved', async () => {
      await expect(researchStep(fixtures.state, ctx)).resolves.toEqual({
        research,
      });

      expect(mocks.agent.research).not.toHaveBeenCalled();
      expect(mocks.run.saveResearchContext).not.toHaveBeenCalled();
    });

    it('should record the saved usage on the meter when research was saved', async () => {
      await researchStep(fixtures.state, ctx);

      expect(mocks.meter.record.mock.calls).toEqual(
        savedUsage.map((usage) => [usage]),
      );
    });

    it('should emit the number of sources found when research was saved', async () => {
      await researchStep(fixtures.state, ctx);

      expect(mocks.emit).toHaveBeenCalledWith({
        type: RunEventType.STEP_PROGRESS,
        data: { step: 'RESEARCH', sourcesFound: 2 },
      });
    });
  });
});
