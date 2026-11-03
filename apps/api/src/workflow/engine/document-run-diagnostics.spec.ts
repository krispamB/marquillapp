import { createHash } from 'node:crypto';
import { FailureCode, WorkflowStep } from '../workflow.constants';
import {
  DocumentRunDiagnostics,
  MAX_MODEL_TURNS,
} from './document-run-diagnostics';
import type { BuildInput, DocumentDiagnostics } from './workflow.types';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

const input = {
  type: 'DOCUMENT',
  kind: 'INITIAL',
  withResearch: false,
  prompt: 'A brief nobody may log',
  userId: 'user-1',
  artifactId: 'artifact-1',
  version: 2,
  designSystem: { id: 'margin', version: 3 },
} as unknown as BuildInput;

const violation = (code: string) => ({ code, detail: `secret ${code}` });

const turn = (overrides: Record<string, unknown> = {}) => ({
  model: 'test/generation-model',
  call: 'draft' as const,
  promptTokens: 4000,
  completionTokens: 6000,
  latencyMs: 30_000,
  finishReason: 'stop',
  ...overrides,
});

const READY = { outcome: 'READY', credits: 368 } as const;
const exhausted = {
  outcome: 'FAILED',
  failureCode: FailureCode.DOCUMENT_REPAIR_EXHAUSTED,
  message: 'still has 1 static violation(s) after 2 Repair turn(s)',
  credits: 360,
} as const;

describe('DocumentRunDiagnostics', () => {
  let clock: number;
  const now = () => clock;
  const start = (
    overrides: { jobAttempt?: number; prior?: DocumentDiagnostics } = {},
  ) =>
    new DocumentRunDiagnostics(
      { runId: 'run-1', input, jobAttempt: 1, ...overrides },
      now,
    );
  let diagnostics: DocumentRunDiagnostics;

  beforeEach(() => {
    clock = 10_000;
    diagnostics = start();
  });

  describe('recordCheck', () => {
    it('should keep every check of every candidate, passes included, as codes and counts', () => {
      diagnostics.recordCheck('static', 'first', [
        violation('typography.scale'),
        violation('typography.scale'),
        violation('color.palette'),
      ]);
      diagnostics.recordCheck('static', 'second', []);
      diagnostics.recordCheck('render', 'second', [violation('page.overflow')]);

      expect(diagnostics.finish(READY).diagnostics.candidates).toEqual([
        {
          candidateSha256: sha('first'),
          checks: [
            {
              phase: 'static',
              passed: false,
              violations: [
                { code: 'typography.scale', count: 2 },
                { code: 'color.palette', count: 1 },
              ],
            },
          ],
        },
        {
          candidateSha256: sha('second'),
          checks: [
            { phase: 'static', passed: true, violations: [] },
            {
              phase: 'render',
              passed: false,
              violations: [{ code: 'page.overflow', count: 1 }],
            },
          ],
        },
      ]);
    });

    it('should never keep Candidate Source text or violation details in the block', () => {
      diagnostics.recordCheck('static', '<section class="page">x</section>', [
        violation('typography.scale'),
      ]);

      const serialized = JSON.stringify(
        diagnostics.finish(exhausted).diagnostics,
      );
      expect(serialized).not.toContain('<section');
      expect(serialized).not.toContain('secret');
    });
  });

  describe('recordModelTurn', () => {
    it('should sum output tokens and keep the last finish reason', () => {
      diagnostics.recordModelTurn(turn({ finishReason: 'stop' }));
      diagnostics.recordModelTurn(
        turn({ completionTokens: 5000, finishReason: 'length' }),
      );

      expect(diagnostics.finish(READY).diagnostics).toMatchObject({
        outputTokens: 11_000,
        finishReason: 'length',
      });
    });

    it('should sum prompt, reasoning and cached prompt tokens', () => {
      diagnostics.recordModelTurn(
        turn({ reasoningTokens: 2500, cachedTokens: 3000 }),
      );
      diagnostics.recordModelTurn(
        turn({ call: 'repair', promptTokens: 5000, reasoningTokens: 1500 }),
      );

      expect(diagnostics.finish(READY).diagnostics).toMatchObject({
        promptTokens: 9000,
        reasoningTokens: 4000,
        cachedPromptTokens: 3000,
      });
    });

    it('should keep one entry per model call with its model, tokens, latency and finish reason', () => {
      diagnostics.recordModelTurn(
        turn({ reasoningTokens: 2500, cachedTokens: 3000, cost: 0.04 }),
      );
      diagnostics.recordModelTurn(
        turn({
          call: 'envelope',
          completionTokens: 700,
          latencyMs: 8000,
          finishReason: undefined,
        }),
      );

      expect(diagnostics.finish(READY).diagnostics.modelTurns).toEqual([
        {
          call: 'draft',
          model: 'test/generation-model',
          promptTokens: 4000,
          completionTokens: 6000,
          reasoningTokens: 2500,
          cachedTokens: 3000,
          latencyMs: 30_000,
          finishReason: 'stop',
        },
        {
          call: 'envelope',
          model: 'test/generation-model',
          promptTokens: 4000,
          completionTokens: 700,
          latencyMs: 8000,
        },
      ]);
    });

    it('should keep only the latest turns once the run passes the bound', () => {
      for (let i = 0; i < MAX_MODEL_TURNS + 2; i++) {
        diagnostics.recordModelTurn(turn({ completionTokens: i }));
      }

      const { diagnostics: finished } = diagnostics.finish(READY);
      expect(finished.modelTurns).toHaveLength(MAX_MODEL_TURNS);
      expect(finished.modelTurns[0].completionTokens).toBe(2);
      expect(finished.modelTurns.at(-1)?.completionTokens).toBe(
        MAX_MODEL_TURNS + 1,
      );
    });
  });

  describe('recordRepairsSpent', () => {
    it("should keep the job attempt's latest running total", () => {
      diagnostics.recordRepairsSpent(1);
      diagnostics.recordRepairsSpent(2);

      expect(diagnostics.finish(READY).diagnostics.repairRounds).toBe(2);
    });
  });

  describe('recordRepair', () => {
    it('should keep one entry per Repair round, in order', () => {
      diagnostics.recordRepair({
        kind: 'static',
        mode: 'patch',
        edits: 3,
        fallback: true,
      });
      diagnostics.recordRepair({
        kind: 'render',
        mode: 'patch',
        edits: 0,
        fallback: false,
      });

      expect(diagnostics.finish(READY).diagnostics.repairs).toEqual([
        { kind: 'static', mode: 'patch', edits: 3, fallback: true },
        { kind: 'render', mode: 'patch', edits: 0, fallback: false },
      ]);
    });

    it('should leave repairs out when no Repair ran', () => {
      expect(diagnostics.finish(READY).diagnostics).not.toHaveProperty(
        'repairs',
      );
    });

    it("should carry on an earlier job attempt's Repairs before this one's", () => {
      diagnostics.recordRepair({
        kind: 'static',
        mode: 'full',
        edits: 0,
        fallback: false,
      });
      const prior = diagnostics.finish({
        outcome: 'RETRYING',
        failureCode: FailureCode.RENDER_UNAVAILABLE,
        message: 'render did not settle',
        credits: 180,
      }).diagnostics;

      const next = start({ jobAttempt: 2, prior });
      next.recordRepair({
        kind: 'render',
        mode: 'full',
        edits: 0,
        fallback: false,
      });

      expect(next.finish(READY).diagnostics.repairs).toEqual([
        { kind: 'static', mode: 'full', edits: 0, fallback: false },
        { kind: 'render', mode: 'full', edits: 0, fallback: false },
      ]);
      expect(prior.repairs).toHaveLength(1);
    });
  });

  describe('recordAccepted', () => {
    it('should reference the checkpoint by hash with its Repairs spent', () => {
      diagnostics.recordAccepted('accepted', 1);

      expect(diagnostics.finish(READY).diagnostics.acceptedCandidate).toEqual({
        candidateSha256: sha('accepted'),
        repairsSpent: 1,
      });
    });
  });

  describe('recordRenderSession', () => {
    it('should count every session', () => {
      diagnostics.recordRenderSession();
      diagnostics.recordRenderSession();

      expect(diagnostics.finish(READY).diagnostics.renderAttempts).toEqual({
        sessions: 2,
      });
    });
  });

  describe('recordPageCount', () => {
    it('should keep the page count', () => {
      diagnostics.recordPageCount(4);

      expect(diagnostics.finish(READY).diagnostics.pageCount).toBe(4);
    });
  });

  describe('stepStarted', () => {
    it('should time a step that never completed until the job attempt ended', () => {
      diagnostics.stepStarted(WorkflowStep.RENDER_PDF);
      clock += 20_000;

      expect(diagnostics.finish(exhausted).diagnostics.stepWallTimeMs).toEqual({
        RENDER_PDF: 20_000,
      });
    });
  });

  describe('stepCompleted', () => {
    it('should time each step and the whole job attempt', () => {
      diagnostics.stepStarted(WorkflowStep.RESOLVE_INPUT);
      clock += 50;
      diagnostics.stepCompleted(WorkflowStep.RESOLVE_INPUT);
      diagnostics.stepStarted(WorkflowStep.GENERATE);
      clock += 40_000;
      diagnostics.stepCompleted(WorkflowStep.GENERATE);

      const { diagnostics: recorded } = diagnostics.finish(READY);
      expect(recorded.stepWallTimeMs).toEqual({
        RESOLVE_INPUT: 50,
        GENERATE: 40_000,
      });
      expect(recorded.wallTimeMs).toBe(40_050);
    });
  });

  describe('finish', () => {
    it('should record the pin, the job attempt, the outcome and the credits when the run is READY', () => {
      const finished = diagnostics.finish(READY);

      expect(finished.diagnostics).toEqual({
        jobAttempt: 1,
        pin: { id: 'margin', version: 3 },
        outcome: 'READY',
        jobAttemptFailures: [],
        candidates: [],
        repairRounds: 0,
        outputTokens: 0,
        promptTokens: 0,
        reasoningTokens: 0,
        cachedPromptTokens: 0,
        modelTurns: [],
        stepWallTimeMs: {},
        wallTimeMs: 0,
        renderAttempts: { sessions: 0 },
        credits: 368,
        recordedAt: new Date(10_000),
      });
      expect(finished.failedCandidateSource).toBeUndefined();
    });

    it('should hand back the last candidate checked as the failed one when the run FAILED', () => {
      diagnostics.recordCheck('static', 'first', [violation('a')]);
      diagnostics.recordCheck('static', 'second', [violation('a')]);

      const finished = diagnostics.finish(exhausted);

      expect(finished.failedCandidateSource).toBe('second');
      expect(finished.diagnostics).toMatchObject({
        outcome: 'FAILED',
        failureCode: 'document.repair_exhausted',
        jobAttemptFailures: [
          {
            jobAttempt: 1,
            failureCode: 'document.repair_exhausted',
            message: exhausted.message,
          },
        ],
        failedCandidate: { candidateSha256: sha('second') },
      });
    });

    it('should fall back to the checkpoint as the failed candidate when no check ran after it', () => {
      diagnostics.recordAccepted('accepted', 0);

      const finished = diagnostics.finish({
        ...exhausted,
        failureCode: FailureCode.RENDER_UNAVAILABLE,
      });

      expect(finished.failedCandidateSource).toBe('accepted');
      expect(finished.diagnostics.failedCandidate).toEqual({
        candidateSha256: sha('accepted'),
      });
    });

    it('should have no failed candidate when the run FAILED before any check', () => {
      const finished = diagnostics.finish({
        ...exhausted,
        failureCode: FailureCode.DESIGN_SYSTEM_UNAVAILABLE,
      });

      expect(finished.failedCandidateSource).toBeUndefined();
      expect(finished.diagnostics).not.toHaveProperty('failedCandidate');
    });

    it('should record a retried job attempt without a final code or failed candidate', () => {
      diagnostics.recordCheck('static', 'clean', []);

      const finished = diagnostics.finish({
        outcome: 'RETRYING',
        failureCode: FailureCode.RENDER_UNAVAILABLE,
        message: 'render did not settle',
        credits: 180,
      });

      expect(finished.diagnostics).toMatchObject({
        outcome: 'RETRYING',
        jobAttemptFailures: [
          {
            jobAttempt: 1,
            failureCode: 'render.unavailable',
            message: 'render did not settle',
          },
        ],
      });
      expect(finished.diagnostics).not.toHaveProperty('failureCode');
      expect(finished.diagnostics).not.toHaveProperty('failedCandidate');
      expect(finished.failedCandidateSource).toBeUndefined();
    });

    it("should carry on an earlier job attempt's diagnostics when given them", () => {
      diagnostics.stepStarted(WorkflowStep.GENERATE);
      diagnostics.recordModelTurn(turn({ reasoningTokens: 2500 }));
      diagnostics.recordCheck('static', 'clean', []);
      diagnostics.recordAccepted('clean', 0);
      diagnostics.recordRenderSession();
      clock += 1_000;
      const prior = diagnostics.finish({
        outcome: 'RETRYING',
        failureCode: FailureCode.RENDER_UNAVAILABLE,
        message: 'render did not settle',
        credits: 180,
      }).diagnostics;

      const next = start({ jobAttempt: 2, prior });
      next.stepStarted(WorkflowStep.GENERATE);
      next.recordAccepted('clean', 0);
      next.recordRenderSession();
      next.recordCheck('render', 'clean', []);
      next.recordPageCount(5);
      next.recordModelTurn(
        turn({ call: 'repair', completionTokens: 1000, cachedTokens: 4000 }),
      );
      clock += 500;

      expect(next.finish({ outcome: 'READY', credits: 8 }).diagnostics).toEqual(
        {
          jobAttempt: 2,
          pin: { id: 'margin', version: 3 },
          outcome: 'READY',
          jobAttemptFailures: [
            {
              jobAttempt: 1,
              failureCode: 'render.unavailable',
              message: 'render did not settle',
            },
          ],
          candidates: [
            {
              candidateSha256: sha('clean'),
              checks: [
                { phase: 'static', passed: true, violations: [] },
                { phase: 'render', passed: true, violations: [] },
              ],
            },
          ],
          repairRounds: 0,
          finishReason: 'stop',
          outputTokens: 7000,
          promptTokens: 8000,
          reasoningTokens: 2500,
          cachedPromptTokens: 4000,
          modelTurns: [
            {
              call: 'draft',
              model: 'test/generation-model',
              promptTokens: 4000,
              completionTokens: 6000,
              reasoningTokens: 2500,
              latencyMs: 30_000,
              finishReason: 'stop',
            },
            {
              call: 'repair',
              model: 'test/generation-model',
              promptTokens: 4000,
              completionTokens: 1000,
              cachedTokens: 4000,
              latencyMs: 30_000,
              finishReason: 'stop',
            },
          ],
          pageCount: 5,
          stepWallTimeMs: { GENERATE: 1_500 },
          wallTimeMs: 1_500,
          renderAttempts: { sessions: 2 },
          acceptedCandidate: {
            candidateSha256: sha('clean'),
            repairsSpent: 0,
          },
          credits: 8,
          recordedAt: new Date(11_500),
        },
      );
    });

    it('should log the run summary as one structured line, without source text', () => {
      diagnostics.recordCheck('static', '<section>candidate text</section>', [
        violation('typography.scale'),
      ]);
      diagnostics.recordRepairsSpent(2);
      diagnostics.recordRenderSession();

      const { completionLine } = diagnostics.finish(exhausted);

      expect(completionLine.startsWith('[DOCUMENT_RUN] ')).toBe(true);
      const fields = JSON.parse(
        completionLine.slice('[DOCUMENT_RUN] '.length),
      ) as Record<string, unknown>;
      expect(fields).toEqual({
        runId: 'run-1',
        artifactId: 'artifact-1',
        version: 2,
        pin: 'margin@3',
        outcome: 'FAILED',
        failureCode: 'document.repair_exhausted',
        repairRounds: 2,
        renderSessions: 1,
        wallTimeMs: 0,
        credits: 360,
      });
      for (const secret of [
        'candidate text',
        'secret',
        'A brief nobody may log',
        exhausted.message,
      ]) {
        expect(completionLine).not.toContain(secret);
      }
    });

    it('should log a null failureCode when the run is READY', () => {
      expect(diagnostics.finish(READY).completionLine).toContain(
        '"outcome":"READY","failureCode":null',
      );
    });
  });
});
