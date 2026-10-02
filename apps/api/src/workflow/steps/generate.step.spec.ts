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
  const run = { recordDocumentCheck: jest.fn().mockResolvedValue(undefined) };
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
    mocks: { agent, meter, run, emit },
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
        },
        expect.anything(),
      );
      expect(mocks.agent.generate).not.toHaveBeenCalled();
      expect(mocks.agent.repairDocument).not.toHaveBeenCalled();
      expect(mockedCheck).toHaveBeenCalledWith(fixtures.definition, draft.html);
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

    it('should fail terminally as document.truncated when the source is over the size cap', async () => {
      mockedCheck.mockReturnValue([
        { code: 'envelope.truncated', detail: 'the document is too big' },
      ]);

      await expect(
        generateStep(fixtures.documentState, ctx),
      ).rejects.toMatchObject({
        retryable: false,
        code: 'document.truncated',
      });
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
