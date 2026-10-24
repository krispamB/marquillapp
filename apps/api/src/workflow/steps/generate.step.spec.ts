jest.mock(
  '../../database/schemas',
  () => ({
    ArtifactType: { POST: 'POST', POLL: 'POLL', DOCUMENT: 'DOCUMENT' },
    RunKind: { INITIAL: 'INITIAL', REFINE: 'REFINE' },
  }),
  { virtual: true },
);

jest.mock('../../document-source/candidate-check', () => ({
  check: jest.fn(),
}));

import {
  ContentValidationError,
  DocumentTruncatedError,
} from '../../agent/agent-runner.error';
import type {
  AgentHooks,
  AgentTurnUsage,
} from '../../agent/agent-runner.interface';
import { LLMError } from '../../llm/errors';
import { WorkflowError } from '../engine/workflow.error';
import type {
  DocumentCheck,
  RunState,
  StepContext,
} from '../engine/workflow.types';
import { check } from '../../document-source/candidate-check';
import { sha256Hex } from '../../document-source/sha256';
import { generateStep } from './generate.step';

const mockedCheck = check as jest.MockedFunction<typeof check>;

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
  const agent = {
    generate: jest.fn(),
    generateDocument: jest.fn(),
    repairDocument: jest.fn(),
    research: jest.fn(),
  };
  const meter = { record: jest.fn() };
  const run = {
    runId: 'run-1',
    recordDocumentCheck: jest.fn().mockResolvedValue(undefined),
    readAcceptedCandidate: jest.fn().mockResolvedValue(undefined),
    recordModelCall: jest.fn(),
  };
  const emit = jest.fn();
  const deadline = {
    assertTimeLeft: jest.fn(),
    remainingMs: jest.fn(() => 120_000),
  };
  const logger = { log: jest.fn() };
  const diagnostics = {
    stepStarted: jest.fn(),
    stepCompleted: jest.fn(),
    recordModelTurn: jest.fn(),
    recordCheck: jest.fn(),
    recordRepairsSpent: jest.fn(),
    recordRepair: jest.fn(),
    recordAccepted: jest.fn(),
    recordRenderSession: jest.fn(),
    recordPageCount: jest.fn(),
  };
  const ctx = {
    agent,
    meter,
    run,
    emit,
    deadline,
    diagnostics,
    logger,
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

  const definition = { id: 'margin', version: 2 };
  const documentState = {
    input: {
      type: 'DOCUMENT',
      kind: 'INITIAL',
      prompt: 'Three fixes for documents',
      stylePreset: 'contrarian',
      artifactId: 'artifact-1',
      version: 1,
      designSystem: { id: 'margin', version: 2 },
    },
    designSystem: { definition, fragment: 'FRAGMENT' },
  } as unknown as RunState;

  return {
    ctx,
    mocks: { agent, meter, run, emit, deadline, diagnostics },
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

describe('generateStep', () => {
  it('should patch the content slot with what the agent generated', async () => {
    const content = { commentary: 'Write more.' };
    mocks.agent.generate.mockResolvedValue({ title: 'Writing more', content });

    await expect(generateStep(fixtures.state, ctx)).resolves.toEqual({
      generatedTitle: 'Writing more',
      content,
    });
  });

  it('should pass the research and refine slots, and the run id as the session, to the agent', async () => {
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
        research,
        refine,
        sessionId: 'run-1',
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

  it("should tally each LLM turn's usage on the run record", async () => {
    const usage = turnUsage({ cost: 0.01, latencyMs: 4000 });
    mocks.agent.generate.mockImplementation(
      (_input: unknown, hooks: AgentHooks) => {
        hooks.onUsage?.(usage);
        return Promise.resolve({ content: { commentary: 'ok' } });
      },
    );

    await generateStep(fixtures.state, ctx);

    expect(mocks.run.recordModelCall).toHaveBeenCalledWith(usage);
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

  describe('for a DOCUMENT run', () => {
    const draft = {
      title: 'Three fixes',
      commentary: 'Swipe through.',
      html: '<!doctype html><html></html>',
      envelopeRepairs: 0,
    };
    const REPAIRED = '<!doctype html><html><body>fixed</body></html>';
    const finding = {
      code: 'typography.scale',
      detail: 'font-size 13px',
      line: 4,
    };

    beforeEach(() => {
      mockedCheck.mockReturnValue([]);
      mocks.agent.generateDocument.mockResolvedValue(draft);
      mocks.agent.repairDocument.mockResolvedValue({
        html: REPAIRED,
        envelopeRepairs: 0,
      });
    });

    it('should draft with the pinned fragment and patch the statically clean Candidate Source', async () => {
      const research = { findings: 'findings', sources: [] };

      await expect(
        generateStep({ ...fixtures.documentState, research }, ctx),
      ).resolves.toEqual({
        generatedTitle: 'Three fixes',
        draft: {
          commentary: 'Swipe through.',
          candidate: draft.html,
          repairsSpent: 0,
        },
      });
      expect(mocks.agent.generateDocument).toHaveBeenCalledWith(
        {
          prompt: 'Three fixes for documents',
          stylePreset: 'contrarian',
          research,
          fragment: 'FRAGMENT',
          includeTitle: true,
          maxEnvelopeRepairs: 1,
          sessionId: 'run-1',
          timeLeftMs: 120_000,
        },
        expect.anything(),
      );
      expect(mocks.agent.generate).not.toHaveBeenCalled();
      expect(mocks.agent.repairDocument).not.toHaveBeenCalled();
      expect(mockedCheck).toHaveBeenCalledWith(fixtures.definition, draft.html);
    });

    it("should draft a refinement from the base's Candidate Source, commentary and feedback, without a title", async () => {
      const base = '<!doctype html><html><body>base</body></html>';
      const state = {
        ...fixtures.documentState,
        input: { ...fixtures.documentState.input, kind: 'REFINE' },
        refine: {
          priorContent: { commentary: 'The original intro.', document: {} },
          feedback: 'Make page two shorter',
        },
        baseCandidate: base,
      } as unknown as RunState;

      await generateStep(state, ctx);

      expect(mocks.agent.generateDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          includeTitle: false,
          fragment: 'FRAGMENT',
          refine: {
            candidate: base,
            commentary: 'The original intro.',
            feedback: 'Make page two shorter',
          },
        }),
        expect.anything(),
      );
    });

    it('should fail terminally when a refinement reaches it without its base', async () => {
      const state = {
        ...fixtures.documentState,
        input: { ...fixtures.documentState.input, kind: 'REFINE' },
      } as unknown as RunState;

      await expect(generateStep(state, ctx)).rejects.toMatchObject({
        retryable: false,
      });
      expect(mocks.agent.generateDocument).not.toHaveBeenCalled();
    });

    it('should emit the draft phase with no violation details', async () => {
      await generateStep(fixtures.documentState, ctx);

      expect(mocks.emit).toHaveBeenCalledTimes(1);
      expect(mocks.emit).toHaveBeenCalledWith({
        type: 'step.progress',
        data: { step: 'GENERATE', phase: 'draft' },
      });
    });

    it('should record the static check with its full violation list on the run', async () => {
      mockedCheck.mockReturnValueOnce([finding]);

      await generateStep(fixtures.documentState, ctx);

      const [check] = mocks.run.recordDocumentCheck.mock.calls[0] as [
        DocumentCheck,
      ];
      expect(check).toMatchObject({
        phase: 'static',
        candidateSha256: sha256Hex(draft.html),
        violations: [finding],
      });
      expect(check.checkedAt).toBeInstanceOf(Date);
    });

    describe('checkpoint replay', () => {
      const accepted = {
        commentary: 'Swipe through.',
        candidate: REPAIRED,
        repairsSpent: 1,
        title: 'Three fixes',
        savedAt: new Date('2026-10-02T00:00:00.000Z'),
      };

      beforeEach(() => {
        mocks.run.readAcceptedCandidate.mockResolvedValue(accepted);
      });

      it('should return the accepted candidate without calling the model', async () => {
        await expect(
          generateStep(fixtures.documentState, ctx),
        ).resolves.toEqual({
          generatedTitle: 'Three fixes',
          draft: {
            commentary: 'Swipe through.',
            candidate: REPAIRED,
            repairsSpent: 1,
          },
        });
        expect(mocks.agent.generateDocument).not.toHaveBeenCalled();
        expect(mocks.agent.repairDocument).not.toHaveBeenCalled();
      });

      it('should report the checkpoint to the diagnostics', async () => {
        await generateStep(fixtures.documentState, ctx);

        expect(mocks.diagnostics.recordAccepted).toHaveBeenCalledWith(
          REPAIRED,
          1,
        );
        expect(mocks.diagnostics.recordRepairsSpent).toHaveBeenCalledWith(1);
      });

      it('should bill nothing, check nothing, and announce no draft', async () => {
        await generateStep(fixtures.documentState, ctx);

        expect(mocks.meter.record).not.toHaveBeenCalled();
        expect(mockedCheck).not.toHaveBeenCalled();
        expect(mocks.emit).not.toHaveBeenCalled();
      });

      it('should carry no title when the checkpoint has none', async () => {
        mocks.run.readAcceptedCandidate.mockResolvedValue({
          ...accepted,
          title: undefined,
        });

        const patch = await generateStep(fixtures.documentState, ctx);

        expect(patch).not.toHaveProperty('generatedTitle');
      });
    });

    describe('the run deadline', () => {
      it('should check it before the draft and each Repair', async () => {
        mockedCheck.mockReturnValueOnce([finding]);

        await generateStep(fixtures.documentState, ctx);

        expect(
          mocks.deadline.assertTimeLeft.mock.calls.map(
            ([step, before]: [string, string]) => `${step}: ${before}`,
          ),
        ).toEqual([
          'GENERATE: the draft of artifact artifact-1 v1',
          'GENERATE: Repair round 1 of artifact artifact-1 v1',
        ]);
      });

      it('should bound the draft and each Repair by the time left when each starts', async () => {
        mockedCheck.mockReturnValueOnce([finding]);
        mocks.deadline.remainingMs
          .mockReturnValueOnce(90_000)
          .mockReturnValueOnce(40_000);

        await generateStep(fixtures.documentState, ctx);

        expect(mocks.agent.generateDocument).toHaveBeenCalledWith(
          expect.objectContaining({ timeLeftMs: 90_000 }),
          expect.anything(),
        );
        expect(mocks.agent.repairDocument).toHaveBeenCalledWith(
          expect.objectContaining({ timeLeftMs: 40_000 }),
          expect.anything(),
        );
      });

      it('should call no model once it has passed', async () => {
        const passed = new WorkflowError('past the deadline', {
          retryable: true,
        });
        mocks.deadline.assertTimeLeft.mockImplementation(() => {
          throw passed;
        });

        await expect(generateStep(fixtures.documentState, ctx)).rejects.toBe(
          passed,
        );
        expect(mocks.agent.generateDocument).not.toHaveBeenCalled();
      });
    });

    describe('static Repair', () => {
      it('should repair the Candidate Source and keep the draft title and commentary', async () => {
        mockedCheck.mockReturnValueOnce([finding]);

        await expect(
          generateStep(fixtures.documentState, ctx),
        ).resolves.toEqual({
          generatedTitle: 'Three fixes',
          draft: {
            commentary: 'Swipe through.',
            candidate: REPAIRED,
            repairsSpent: 1,
          },
        });
        expect(mocks.agent.repairDocument).toHaveBeenCalledWith(
          {
            fragment: 'FRAGMENT',
            includeTitle: true,
            candidate: draft.html,
            violations: { violations: [finding], omitted: [] },
            maxEnvelopeRepairs: 1,
            sessionId: 'run-1',
            timeLeftMs: 120_000,
          },
          expect.anything(),
        );
        expect(mockedCheck).toHaveBeenLastCalledWith(
          fixtures.definition,
          REPAIRED,
        );
      });

      it('should send the model a bounded violation list', async () => {
        mockedCheck.mockReturnValueOnce(
          Array.from({ length: 5 }, (_, i) => ({ ...finding, line: i + 1 })),
        );

        await generateStep(fixtures.documentState, ctx);

        const [input] = mocks.agent.repairDocument.mock.calls[0] as [
          { violations: { violations: unknown[]; omitted: unknown[] } },
        ];
        expect(input.violations.violations).toHaveLength(3);
        expect(input.violations.omitted).toEqual([
          { code: 'typography.scale', count: 2 },
        ]);
      });

      it('should emit each Repair round with its violation count and no details', async () => {
        mockedCheck
          .mockReturnValueOnce([finding, finding])
          .mockReturnValueOnce([finding]);

        await generateStep(fixtures.documentState, ctx);

        expect(
          mocks.emit.mock.calls.map(([event]: [unknown]) => event),
        ).toEqual([
          { type: 'step.progress', data: { step: 'GENERATE', phase: 'draft' } },
          {
            type: 'step.progress',
            data: {
              step: 'GENERATE',
              phase: 'repair',
              round: 1,
              violations: 2,
            },
          },
          {
            type: 'step.progress',
            data: {
              step: 'GENERATE',
              phase: 'repair',
              round: 2,
              violations: 1,
            },
          },
        ]);
      });

      it('should record every static check on the run', async () => {
        mockedCheck.mockReturnValueOnce([finding]);

        await generateStep(fixtures.documentState, ctx);

        expect(
          mocks.run.recordDocumentCheck.mock.calls.map(
            ([check]: [DocumentCheck]) => [
              check.candidateSha256,
              check.violations,
            ],
          ),
        ).toEqual([
          [sha256Hex(draft.html), [finding]],
          [sha256Hex(REPAIRED), []],
        ]);
      });

      it('should fail terminally as document.repair_exhausted when two Repairs leave violations', async () => {
        mockedCheck.mockReturnValue([finding]);

        await expect(
          generateStep(fixtures.documentState, ctx),
        ).rejects.toMatchObject({
          retryable: false,
          code: 'document.repair_exhausted',
        });
        expect(mocks.agent.repairDocument).toHaveBeenCalledTimes(2);
        const [[first], [second]] = mocks.agent.repairDocument.mock.calls as [
          [{ candidate: string; maxEnvelopeRepairs: number }],
          [{ candidate: string; maxEnvelopeRepairs: number }],
        ];
        expect(first).toMatchObject({
          candidate: draft.html,
          maxEnvelopeRepairs: 1,
        });
        expect(second).toMatchObject({
          candidate: REPAIRED,
          maxEnvelopeRepairs: 0,
        });
      });

      it("should charge the draft's Zod repair turn to the budget", async () => {
        mocks.agent.generateDocument.mockResolvedValue({
          ...draft,
          envelopeRepairs: 1,
        });
        mockedCheck.mockReturnValue([finding]);

        await expect(
          generateStep(fixtures.documentState, ctx),
        ).rejects.toMatchObject({ code: 'document.repair_exhausted' });
        expect(mocks.agent.repairDocument).toHaveBeenCalledTimes(1);
        expect(mocks.agent.repairDocument).toHaveBeenCalledWith(
          expect.objectContaining({ maxEnvelopeRepairs: 0 }),
          expect.anything(),
        );
        expect(mocks.emit).toHaveBeenLastCalledWith({
          type: 'step.progress',
          data: { step: 'GENERATE', phase: 'repair', round: 2, violations: 1 },
        });
      });

      it("should charge a Repair's Zod repair turn to the budget", async () => {
        mocks.agent.repairDocument.mockResolvedValue({
          html: REPAIRED,
          envelopeRepairs: 1,
        });
        mockedCheck.mockReturnValue([finding]);

        await expect(
          generateStep(fixtures.documentState, ctx),
        ).rejects.toMatchObject({ code: 'document.repair_exhausted' });
        expect(mocks.agent.repairDocument).toHaveBeenCalledTimes(1);
      });

      it('should report the turns spent when a Repair comes back clean', async () => {
        mocks.agent.repairDocument.mockResolvedValue({
          html: REPAIRED,
          envelopeRepairs: 1,
        });
        mockedCheck.mockReturnValueOnce([finding]);

        await expect(
          generateStep(fixtures.documentState, ctx),
        ).resolves.toMatchObject({ draft: { repairsSpent: 2 } });
      });

      it('should fail terminally as document.repair_exhausted when a Repair envelope is invalid with no turn left', async () => {
        mockedCheck.mockReturnValue([finding]);
        mocks.agent.repairDocument
          .mockResolvedValueOnce({ html: REPAIRED, envelopeRepairs: 0 })
          .mockRejectedValueOnce(new ContentValidationError('html empty'));

        await expect(
          generateStep(fixtures.documentState, ctx),
        ).rejects.toMatchObject({
          retryable: false,
          code: 'document.repair_exhausted',
        });
      });

      it('should fail terminally as internal when a Repair envelope is invalid after its repair turn', async () => {
        mockedCheck.mockReturnValueOnce([finding]);
        mocks.agent.repairDocument.mockRejectedValue(
          new ContentValidationError('html empty'),
        );

        const error = await generateStep(fixtures.documentState, ctx).catch(
          (e: unknown) => e,
        );
        expect(error).toMatchObject({ retryable: false });
        expect((error as WorkflowError).code).toBeUndefined();
      });

      it('should meter every LLM turn of every Repair', async () => {
        mockedCheck.mockReturnValueOnce([finding]);
        mocks.agent.repairDocument.mockImplementation(
          (_input: unknown, hooks: AgentHooks) => {
            hooks.onUsage?.(turnUsage({ cost: 0.07 }));
            hooks.onUsage?.(turnUsage({ cost: 0.08 }));
            return Promise.resolve({ html: REPAIRED, envelopeRepairs: 1 });
          },
        );

        await generateStep(fixtures.documentState, ctx);

        expect(
          mocks.meter.record.mock.calls.map(
            ([record]: [{ amount: number }]) => record.amount,
          ),
        ).toEqual([0.07, 0.08]);
      });
    });

    describe('truncation', () => {
      const oversized = {
        code: 'envelope.truncated',
        detail: 'the document is too big',
      };

      it('should fail terminally as document.truncated, spending no Repair, when the draft is over the size cap', async () => {
        mockedCheck.mockReturnValue([oversized]);

        await expect(
          generateStep(fixtures.documentState, ctx),
        ).rejects.toMatchObject({
          retryable: false,
          code: 'document.truncated',
        });
        expect(mocks.agent.repairDocument).not.toHaveBeenCalled();
      });

      it('should fail terminally as document.truncated when the draft hit the token cap', async () => {
        mocks.agent.generateDocument.mockRejectedValue(
          new DocumentTruncatedError('cut off'),
        );

        await expect(
          generateStep(fixtures.documentState, ctx),
        ).rejects.toMatchObject({
          retryable: false,
          code: 'document.truncated',
        });
        expect(mockedCheck).not.toHaveBeenCalled();
        expect(mocks.agent.repairDocument).not.toHaveBeenCalled();
      });

      it('should fail terminally as document.truncated, without another Repair, when a Repair hit the token cap', async () => {
        mockedCheck.mockReturnValueOnce([finding]);
        mocks.agent.repairDocument.mockRejectedValue(
          new DocumentTruncatedError('cut off'),
        );

        await expect(
          generateStep(fixtures.documentState, ctx),
        ).rejects.toMatchObject({
          retryable: false,
          code: 'document.truncated',
        });
        expect(mocks.agent.repairDocument).toHaveBeenCalledTimes(1);
        expect(mockedCheck).toHaveBeenCalledTimes(1);
      });

      it('should fail terminally as document.truncated, without another Repair, when a Repair is over the size cap', async () => {
        mockedCheck
          .mockReturnValueOnce([finding])
          .mockReturnValueOnce([oversized]);

        await expect(
          generateStep(fixtures.documentState, ctx),
        ).rejects.toMatchObject({
          retryable: false,
          code: 'document.truncated',
        });
        expect(mocks.agent.repairDocument).toHaveBeenCalledTimes(1);
      });
    });

    it('should fail terminally when the envelope is invalid after the repair retry', async () => {
      mocks.agent.generateDocument.mockRejectedValue(
        new ContentValidationError('html must not be empty'),
      );

      const error = await generateStep(fixtures.documentState, ctx).catch(
        (e: unknown) => e,
      );
      expect(error).toMatchObject({ retryable: false });
      expect((error as WorkflowError).code).toBeUndefined();
    });

    it('should meter every LLM turn of the draft', async () => {
      mocks.agent.generateDocument.mockImplementation(
        (_input: unknown, hooks: AgentHooks) => {
          hooks.onUsage?.(turnUsage({ cost: 0.05 }));
          return Promise.resolve(draft);
        },
      );

      await generateStep(fixtures.documentState, ctx);

      expect(mocks.meter.record).toHaveBeenCalledWith({
        kind: 'llm',
        amount: 0.05,
        detail: { model: 'test/generation-model', totalTokens: 150 },
      });
    });

    it("should report every model turn's output tokens and finish reason to the diagnostics", async () => {
      mocks.agent.generateDocument.mockImplementation(
        (_input: unknown, hooks: AgentHooks) => {
          hooks.onUsage?.(
            turnUsage({ completionTokens: 6000, finishReason: 'stop' }),
          );
          return Promise.resolve(draft);
        },
      );

      await generateStep(fixtures.documentState, ctx);

      expect(mocks.diagnostics.recordModelTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          completionTokens: 6000,
          finishReason: 'stop',
        }),
      );
    });

    it('should report the static check and the Repairs spent to the diagnostics', async () => {
      mockedCheck.mockReturnValueOnce([finding]).mockReturnValueOnce([]);
      mocks.agent.generateDocument.mockResolvedValue({
        ...draft,
        envelopeRepairs: 1,
      });

      await generateStep(fixtures.documentState, ctx);

      expect(mocks.diagnostics.recordCheck.mock.calls).toEqual([
        ['static', draft.html, [finding]],
        ['static', REPAIRED, []],
      ]);
      expect(mocks.diagnostics.recordRepairsSpent.mock.calls).toEqual([
        [1],
        [2],
      ]);
    });

    it('should fail terminally when RESOLVE_INPUT left no Design System', async () => {
      const state = {
        ...fixtures.documentState,
        designSystem: undefined,
      } as RunState;

      await expect(generateStep(state, ctx)).rejects.toMatchObject({
        retryable: false,
      });
      expect(mocks.agent.generateDocument).not.toHaveBeenCalled();
    });
  });
});
