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
    };

    beforeEach(() => {
      mockedCheck.mockReturnValue([]);
      mocks.agent.generateDocument.mockResolvedValue(draft);
    });

    it('should draft with the pinned fragment and patch the statically clean Candidate Source', async () => {
      const research = { findings: 'findings', sources: [] };

      await expect(
        generateStep({ ...fixtures.documentState, research }, ctx),
      ).resolves.toEqual({
        generatedTitle: 'Three fixes',
        draft: { commentary: 'Swipe through.', candidate: draft.html },
      });
      expect(mocks.agent.generateDocument).toHaveBeenCalledWith(
        {
          prompt: 'Three fixes for documents',
          stylePreset: 'contrarian',
          research,
          fragment: 'FRAGMENT',
          includeTitle: true,
        },
        expect.anything(),
      );
      expect(mocks.agent.generate).not.toHaveBeenCalled();
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
      const violations = [
        { code: 'typography.scale', detail: 'font-size 13px', line: 4 },
      ];
      mockedCheck.mockReturnValue(violations);

      await generateStep(fixtures.documentState, ctx).catch(() => undefined);

      const [check] = mocks.run.recordDocumentCheck.mock.calls[0] as [
        DocumentCheck,
      ];
      expect(check).toMatchObject({
        phase: 'static',
        candidateSha256: sha256Hex(draft.html),
        violations,
      });
      expect(check.checkedAt).toBeInstanceOf(Date);
    });

    it('should fail terminally as document.repair_exhausted when the static check finds anything', async () => {
      mockedCheck.mockReturnValue([
        { code: 'typography.scale', detail: 'font-size 13px', line: 4 },
      ]);

      await expect(
        generateStep(fixtures.documentState, ctx),
      ).rejects.toMatchObject({
        retryable: false,
        code: 'document.repair_exhausted',
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
