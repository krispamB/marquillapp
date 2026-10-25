import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The builder and steps read these enums at load; the real barrel drags in
// Mongoose.
jest.mock(
  '../database/schemas',
  () => ({
    ArtifactType: { POST: 'POST', POLL: 'POLL', DOCUMENT: 'DOCUMENT' },
    RunKind: { INITIAL: 'INITIAL', REFINE: 'REFINE' },
    VersionStatus: {
      GENERATING: 'GENERATING',
      READY: 'READY',
      FAILED: 'FAILED',
    },
  }),
  { virtual: true },
);

// The in-step render retry pauses ~2 s; the tests do not.
jest.mock('node:timers/promises', () => ({
  setTimeout: jest.fn().mockResolvedValue(undefined),
}));

import { DocumentTruncatedError } from '../agent/agent-runner.error';
import type {
  AgentHooks,
  AgentTurnUsage,
  DocumentDraftResult,
  DocumentGenerateInput,
  DocumentRepairInput,
  DocumentRepairResult,
} from '../agent/agent-runner.interface';
import { parseDesignSystemDefinition } from '../design-system/design-system-definition';
import { DESIGN_SYSTEM_SEED_DIR } from '../design-system/design-system.constants';
import type { RenderFacts } from '../document-render/render-facts';
import type { RenderSessionResult } from '../document-render/render-session';
import type { RenderAttemptUsage } from '../document-render/render-usage.types';
import { NotFoundException } from '@nestjs/common';
import type {
  AcceptedCandidate,
  BuildInput,
  DocumentCheck,
  DocumentDiagnostics,
} from './engine/workflow.types';
import {
  ArtifactRunProcessor,
  type ArtifactRunDeps,
} from './workers/artifact-run.worker.handler';

/**
 * Test layer 3 (spec §11.2): a DOCUMENT run through the real worker
 * processor, engine, steps, checker, assembly and judge, with a scripted fake
 * agent and renderer. The renderer replays probe facts the real session
 * recorded (`test:render`), so the judge decides on real measurements.
 *
 * The paths: clean; a static Repair that succeeds; static Repairs that run
 * out; a render Repair that succeeds; render Repairs that run out;
 * truncation of the draft or a Repair; an in-step render retry; a render
 * outage, then a job retry that resumes from the checkpoint; egress; the run
 * deadline; a stale contract; and a refinement that carries its base's pin
 * and reads its `candidate.html`, switches system, meets a stale contract, or
 * finds its base's Candidate Source missing.
 * Each asserts step events, `step.progress`, meter records and `failureCode`.
 * The run's diagnostics, alert lines and completion line are asserted on the
 * clean path, exhaustion, a checkpoint resume, and the alerting failures.
 */

const readSeed = (file: string) =>
  readFileSync(join(DESIGN_SYSTEM_SEED_DIR, 'margin', file), 'utf8');

const parsed = parseDesignSystemDefinition(readSeed('definition.ds.yaml'));
if (!parsed.success) throw new Error(parsed.errors.join('\n'));
const margin = parsed.definition;
const MARGIN_SAMPLE = readSeed('sample.html');

const recorded = (name: string): RenderFacts =>
  JSON.parse(
    readFileSync(
      join(
        __dirname,
        '..',
        'document-render',
        'recorded-facts',
        `${name}.json`,
      ),
      'utf8',
    ),
  ) as RenderFacts;

/** The draft with a type size off the scale: one static violation. */
const OFF_SCALE = MARGIN_SAMPLE.replace(
  '<style>',
  '<style>p { font-size: 13px; }',
);

const PDF = new Uint8Array([37, 80, 68, 70, 45]);
const PNG = new Uint8Array([137, 80, 78, 71]);

const session = (
  facts: RenderFacts,
  overrides: Partial<RenderSessionResult> = {},
): RenderSessionResult => ({
  facts,
  pdf: PDF,
  pageCount: facts.pdfPageCount,
  cover: { ok: true, png: PNG },
  refusedRequests: facts.refusedRequests,
  usage: { durationMs: 15_000, units: 1 },
  trace: { phase: 'pdf', phaseMs: { connect: 900, pdf: 3_000 } },
  ...overrides,
});

const buildInput = (overrides: Partial<BuildInput> = {}): BuildInput =>
  ({
    type: 'DOCUMENT',
    kind: 'INITIAL',
    withResearch: false,
    prompt: 'Three fixes for documents people actually finish',
    userId: 'user-1',
    artifactId: 'artifact-1',
    version: 1,
    designSystem: { id: 'margin', version: margin.version },
    ...overrides,
  }) as unknown as BuildInput;

const makeJob = (overrides: Partial<Job<BuildInput>> = {}): Job<BuildInput> =>
  ({
    id: 'run-1',
    data: buildInput(),
    // BullMQ counts the attempts that already failed: a first attempt has 0.
    attemptsMade: 0,
    opts: { attempts: 3 },
    // BullMQ stamps every job; the prompts take the run's date from it.
    timestamp: Date.parse('2026-10-25T12:00:00Z'),
    ...overrides,
  }) as unknown as Job<BuildInput>;

const makeRun = () => {
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
  const redis = {
    xadd: jest.fn<Promise<string>, unknown[]>().mockResolvedValue('1-0'),
    expire: jest.fn().mockResolvedValue(1),
  };
  const turn: AgentTurnUsage = {
    promptTokens: 4000,
    completionTokens: 6000,
    totalTokens: 10_000,
    cost: 0.09,
    model: 'test/generation-model',
    finishReason: 'stop',
  };
  const agent = {
    generate: jest.fn(),
    research: jest.fn(),
    generateDocument: jest.fn(
      (
        input: DocumentGenerateInput,
        hooks?: AgentHooks,
      ): Promise<DocumentDraftResult> => {
        hooks?.onUsage?.({ ...turn, call: 'draft' });
        // As the real agent: a title only when one was asked for.
        return Promise.resolve({
          ...(input.includeTitle ? { title: 'Three fixes' } : {}),
          commentary: 'Three fixes, one per page. Swipe through.',
          html: MARGIN_SAMPLE,
          envelopeRepairs: 0,
        });
      },
    ),
    repairDocument: jest.fn(
      (
        _input: DocumentRepairInput,
        hooks?: AgentHooks,
      ): Promise<DocumentRepairResult> => {
        hooks?.onUsage?.({ ...turn, call: 'repair' });
        return Promise.resolve({ html: MARGIN_SAMPLE, envelopeRepairs: 0 });
      },
    ),
  };
  const artifacts = {
    readVersion: jest.fn().mockResolvedValue({ status: 'GENERATING' }),
    readRefineInput: jest.fn(),
    promoteVersion: jest.fn().mockResolvedValue(undefined),
    failVersion: jest.fn().mockResolvedValue('FAILED'),
  };
  const designSystems = {
    resolve: jest
      .fn()
      .mockResolvedValue({ contract: 1, definition: margin, name: 'Margin' }),
  };
  const renderer = {
    render: jest.fn().mockResolvedValue(session(recorded('margin-sample'))),
  };
  const objects = {
    put: jest
      .fn<Promise<void>, [string, Buffer, string]>()
      .mockResolvedValue(undefined),
    get: jest.fn<Promise<Buffer | null>, [string]>().mockResolvedValue(null),
  };
  // One run record across job attempts, so a retry reads the checkpoint the
  // failed attempt saved.
  let accepted: AcceptedCandidate | undefined;
  let diagnostics: DocumentDiagnostics | undefined;
  const runHandle = {
    runId: 'run-1',
    saveAcceptedCandidate: jest.fn((candidate: AcceptedCandidate) => {
      accepted = candidate;
      return Promise.resolve();
    }),
    readAcceptedCandidate: jest.fn(() => Promise.resolve(accepted)),
    saveResearchContext: jest.fn().mockResolvedValue(undefined),
    readResearchContext: jest.fn().mockResolvedValue(undefined),
    recordRenderAttempt: jest
      .fn<Promise<void>, [RenderAttemptUsage]>()
      .mockResolvedValue(undefined),
    recordDocumentCheck: jest
      .fn<Promise<void>, [DocumentCheck]>()
      .mockResolvedValue(undefined),
    getLatestCompletedResearch: jest.fn(),
    readAcceptedCandidateText: jest.fn(),
    complete: jest.fn().mockResolvedValue(undefined),
    fail: jest.fn().mockResolvedValue(undefined),
    recordQueueWait: jest.fn().mockResolvedValue(undefined),
    recordModelCall: jest.fn(),
    readDocumentDiagnostics: jest.fn(() => Promise.resolve(diagnostics)),
    saveDocumentDiagnostics: jest.fn<
      Promise<void>,
      [DocumentDiagnostics, string?]
    >((saved) => {
      diagnostics = saved;
      return Promise.resolve();
    }),
  };
  const creditMeter = {
    assertBalance: jest.fn().mockResolvedValue(undefined),
    toCredits: jest.fn((usage: { kind: string }) =>
      usage.kind === 'pdf_render' ? 8 : 180,
    ),
    debit: jest.fn().mockResolvedValue(undefined),
  };

  const deps: ArtifactRunDeps = {
    agent: agent as never,
    artifacts: artifacts as never,
    designSystems: designSystems as never,
    renderer: renderer as never,
    fonts: { inlineCss: jest.fn().mockResolvedValue(null) },
    objects,
    creditMeter: creditMeter as never,
    featureGating: {
      resolveEntitlement: jest.fn().mockResolvedValue(undefined),
      assertResearchAccess: jest.fn(),
    } as never,
    runs: { handleFor: jest.fn().mockReturnValue(runHandle) } as never,
    inflight: {
      refresh: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    },
    redis: redis as never,
    logger,
  };
  const processor = new ArtifactRunProcessor(deps);

  return {
    processor,
    deps,
    logger,
    redis,
    agent,
    artifacts,
    designSystems,
    renderer,
    objects,
    runHandle,
    creditMeter,
  };
};

type Run = ReturnType<typeof makeRun>;

interface Emitted {
  type: string;
  data: Record<string, unknown>;
}

const emitted = ({ redis }: Run): Emitted[] =>
  redis.xadd.mock.calls.map((call) => {
    // `seq` and `ts` ride inside the stored payload; the rest is the data.
    const data = JSON.parse(call[8] as string) as Record<string, unknown>;
    delete data.seq;
    delete data.ts;
    return { type: call[6] as string, data };
  });

const lifecycle = (run: Run): string[] =>
  emitted(run)
    .filter(({ type }) => type.startsWith('step.') || type.startsWith('run.'))
    .filter(({ type }) => type !== 'step.progress')
    .map(({ type, data }) =>
      typeof data.step === 'string' ? `${type} ${data.step}` : type,
    );

const progress = (run: Run): Record<string, unknown>[] =>
  emitted(run)
    .filter(({ type }) => type === 'step.progress')
    .map(({ data }) => data);

const meterRecords = ({ creditMeter }: Run): string[] =>
  creditMeter.toCredits.mock.calls.map(
    ([usage]) => (usage as { kind: string }).kind,
  );

/** Runs one job attempt, and hands a failure to `onFailed` as BullMQ does. */
const runJob = async (run: Run, job = makeJob()): Promise<unknown> => {
  try {
    await run.processor.process(job);
    return undefined;
  } catch (error: unknown) {
    await run.processor.onFailed(job, error as Error);
    return error;
  }
};

const failedWith = (run: Run) =>
  emitted(run).find((e) => e.type === 'run.failed')?.data;

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** The diagnostics the run ended with, and the failed candidate's text. */
const savedDiagnostics = ({ runHandle }: Run) => {
  const calls = runHandle.saveDocumentDiagnostics.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const [diagnostics, failedCandidate] = calls[calls.length - 1];
  return { diagnostics, failedCandidate };
};

const loggedLines = ({ logger }: Run): string[] =>
  (['log', 'warn', 'error'] as const).flatMap((level) =>
    (logger[level] as unknown as jest.Mock).mock.calls.map((call: unknown[]) =>
      call.map(String).join(' '),
    ),
  );

const completionLines = (run: Run): Record<string, unknown>[] =>
  loggedLines(run)
    .filter((line) => line.startsWith('[DOCUMENT_RUN] '))
    .map(
      (line) =>
        JSON.parse(line.slice('[DOCUMENT_RUN] '.length)) as Record<
          string,
          unknown
        >,
    );

/** Text that must only ever live on the run record (spec §11.6). */
const expectNothingPrivateLogged = (run: Run, ...sources: string[]) => {
  const prompt = buildInput().prompt;
  for (const line of loggedLines(run)) {
    expect(line).not.toContain(prompt);
    expect(line).not.toContain('<section');
    for (const source of sources) expect(line).not.toContain(source);
  }
};

let run: Run;

beforeEach(() => {
  jest.clearAllMocks();
  run = makeRun();
});

describe('DOCUMENT generation, end to end', () => {
  describe('the clean path', () => {
    it('should run the four steps and announce the draft and render phases', async () => {
      await expect(runJob(run)).resolves.toBeUndefined();

      expect(emitted(run)[0]).toMatchObject({
        type: 'run.started',
        data: {
          steps: ['RESOLVE_INPUT', 'GENERATE', 'RENDER_PDF', 'PERSIST_VERSION'],
        },
      });
      expect(lifecycle(run)).toEqual([
        'run.started',
        'step.started RESOLVE_INPUT',
        'step.completed RESOLVE_INPUT',
        'step.started GENERATE',
        'step.completed GENERATE',
        'step.started RENDER_PDF',
        'step.completed RENDER_PDF',
        'step.started PERSIST_VERSION',
        'step.completed PERSIST_VERSION',
        'run.completed',
      ]);
      expect(progress(run)).toEqual([
        { step: 'GENERATE', phase: 'draft' },
        { step: 'RENDER_PDF', phase: 'render', session: 1 },
      ]);
    });

    it('should meter the LLM turn and one pdf_render, and commit them once', async () => {
      await runJob(run);

      expect(meterRecords(run)).toEqual(['llm', 'pdf_render']);
      expect(run.creditMeter.toCredits).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'pdf_render', amount: 1 }),
      );
      expect(run.creditMeter.debit).toHaveBeenCalledTimes(1);
      expect(run.runHandle.recordRenderAttempt).toHaveBeenCalledWith({
        durationMs: 15_000,
        units: 1,
        phase: 'pdf',
        phaseMs: { connect: 900, pdf: 3_000 },
        outcome: 'PASSED',
        billed: true,
      });
    });

    it('should upload the four objects and promote the Document Version', async () => {
      await runJob(run);

      expect(run.objects.put.mock.calls.map(([key]) => key)).toEqual([
        'artifacts/artifact-1/1/candidate.html',
        'artifacts/artifact-1/1/source.html',
        'artifacts/artifact-1/1/document.pdf',
        'artifacts/artifact-1/1/cover.png',
      ]);
      expect(run.artifacts.promoteVersion).toHaveBeenCalledWith(
        'artifact-1',
        1,
        {
          commentary: 'Three fixes, one per page. Swipe through.',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- an asymmetric matcher
          document: expect.objectContaining({
            designSystemId: 'margin',
            designSystemVersion: margin.version,
            pdfKey: 'artifacts/artifact-1/1/document.pdf',
            pageCount: 5,
            coverKey: 'artifacts/artifact-1/1/cover.png',
          }),
        },
        { title: 'Three fixes' },
      );
    });

    it('should record a clean static and render check on the run', async () => {
      await runJob(run);

      expect(
        run.runHandle.recordDocumentCheck.mock.calls.map(([check]) => [
          check.phase,
          check.violations,
        ]),
      ).toEqual([
        ['static', []],
        ['render', []],
      ]);
    });
  });

  describe('a static finding that one Repair fixes', () => {
    beforeEach(() => {
      const draft = run.agent.generateDocument.getMockImplementation()!;
      run.agent.generateDocument.mockImplementation(async (input, hooks) => ({
        ...(await draft(input, hooks)),
        html: OFF_SCALE,
      }));
    });

    it('should repair in GENERATE, then render and promote the repaired source', async () => {
      await expect(runJob(run)).resolves.toBeUndefined();

      expect(lifecycle(run)).toEqual([
        'run.started',
        'step.started RESOLVE_INPUT',
        'step.completed RESOLVE_INPUT',
        'step.started GENERATE',
        'step.completed GENERATE',
        'step.started RENDER_PDF',
        'step.completed RENDER_PDF',
        'step.started PERSIST_VERSION',
        'step.completed PERSIST_VERSION',
        'run.completed',
      ]);
      expect(progress(run)).toEqual([
        { step: 'GENERATE', phase: 'draft' },
        { step: 'GENERATE', phase: 'repair', round: 1, violations: 1 },
        { step: 'RENDER_PDF', phase: 'render', session: 1 },
      ]);
      const [[input]] = run.agent.repairDocument.mock.calls;
      expect(input.candidate).toBe(OFF_SCALE);
      expect(input.violations.violations).toEqual([
        expect.objectContaining({ code: 'typography.rules.minPx' }),
      ]);
      expect(run.renderer.render).toHaveBeenCalledTimes(1);
      expect(run.artifacts.promoteVersion).toHaveBeenCalledWith(
        'artifact-1',
        1,
        expect.objectContaining({
          commentary: 'Three fixes, one per page. Swipe through.',
        }),
        { title: 'Three fixes' },
      );
    });

    it('should bill the draft and the Repair as separate LLM turns, with usage.tick climbing', async () => {
      await runJob(run);

      expect(meterRecords(run)).toEqual(['llm', 'llm', 'pdf_render']);
      expect(
        emitted(run)
          .filter(({ type }) => type === 'usage.tick')
          .map(({ data }) => data.totalCredits),
      ).toEqual([180, 360, 368]);
      expect(run.creditMeter.debit).toHaveBeenCalledTimes(1);
    });

    it('should record both static checks, and keep violation details out of every event', async () => {
      await runJob(run);

      expect(
        run.runHandle.recordDocumentCheck.mock.calls.map(([check]) => [
          check.phase,
          check.violations.length,
        ]),
      ).toEqual([
        ['static', 1],
        ['static', 0],
        ['render', 0],
      ]);
      expect(JSON.stringify(emitted(run))).not.toContain('13px');
    });
  });

  describe('static findings that outlast the Repair budget', () => {
    beforeEach(() => {
      const draft = run.agent.generateDocument.getMockImplementation()!;
      run.agent.generateDocument.mockImplementation(async (input, hooks) => ({
        ...(await draft(input, hooks)),
        html: OFF_SCALE,
      }));
      const repair = run.agent.repairDocument.getMockImplementation()!;
      run.agent.repairDocument.mockImplementation(async (input, hooks) => ({
        ...(await repair(input, hooks)),
        html: OFF_SCALE,
      }));
    });

    it('should fail GENERATE as document.repair_exhausted after two Repairs, before any render', async () => {
      await runJob(run);

      expect(lifecycle(run)).toEqual([
        'run.started',
        'step.started RESOLVE_INPUT',
        'step.completed RESOLVE_INPUT',
        'step.started GENERATE',
        'step.failed GENERATE',
        'run.failed',
      ]);
      expect(progress(run)).toEqual([
        { step: 'GENERATE', phase: 'draft' },
        { step: 'GENERATE', phase: 'repair', round: 1, violations: 1 },
        { step: 'GENERATE', phase: 'repair', round: 2, violations: 1 },
      ]);
      expect(failedWith(run)).toEqual({
        code: 'document.repair_exhausted',
        failureReason:
          "We couldn't get this design to fit cleanly. Try refining with a shorter brief or another design.",
      });
      expect(run.artifacts.failVersion).toHaveBeenCalledWith(
        'artifact-1',
        1,
        'document.repair_exhausted',
        expect.any(String),
      );
      expect(run.renderer.render).not.toHaveBeenCalled();
    });

    it('should meter all three LLM turns but never commit credits', async () => {
      await runJob(run);

      expect(meterRecords(run)).toEqual(['llm', 'llm', 'llm']);
      expect(run.creditMeter.debit).not.toHaveBeenCalled();
    });
  });

  describe('a render finding that one render Repair fixes', () => {
    beforeEach(() => {
      run.renderer.render
        .mockResolvedValueOnce(session(recorded('safe-area')))
        .mockResolvedValueOnce(
          session(recorded('margin-sample'), {
            usage: { durationMs: 16_000, units: 1 },
          }),
        );
    });

    it('should repair in RENDER_PDF, re-render, and promote the repaired source', async () => {
      await expect(runJob(run)).resolves.toBeUndefined();

      expect(lifecycle(run)).toEqual([
        'run.started',
        'step.started RESOLVE_INPUT',
        'step.completed RESOLVE_INPUT',
        'step.started GENERATE',
        'step.completed GENERATE',
        'step.started RENDER_PDF',
        'step.completed RENDER_PDF',
        'step.started PERSIST_VERSION',
        'step.completed PERSIST_VERSION',
        'run.completed',
      ]);
      const findings =
        run.runHandle.recordDocumentCheck.mock.calls[1][0].violations.length;
      expect(progress(run)).toEqual([
        { step: 'GENERATE', phase: 'draft' },
        { step: 'RENDER_PDF', phase: 'render', session: 1 },
        { step: 'RENDER_PDF', phase: 'repair', round: 1, violations: findings },
        { step: 'RENDER_PDF', phase: 'render', session: 2 },
      ]);
      const [[input]] = run.agent.repairDocument.mock.calls;
      expect(input.candidate).toBe(MARGIN_SAMPLE);
      expect(input.violations.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'page.safeArea' }),
        ]),
      );
      expect(run.artifacts.promoteVersion).toHaveBeenCalledTimes(1);
    });

    it('should statically re-check the re-emitted source before rendering it', async () => {
      await runJob(run);

      expect(
        run.runHandle.recordDocumentCheck.mock.calls.map(([check]) => [
          check.phase,
          check.violations.length > 0,
        ]),
      ).toEqual([
        ['static', false],
        ['render', true],
        ['static', false],
        ['render', false],
      ]);
    });

    it('should bill two LLM turns and one pdf_render over both judged sessions', async () => {
      await runJob(run);

      expect(meterRecords(run)).toEqual(['llm', 'llm', 'pdf_render']);
      expect(run.creditMeter.toCredits).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'pdf_render',
          amount: 2,
          detail: { browserless: { durationMs: 31_000, units: 2 } },
        }),
      );
      expect(
        run.runHandle.recordRenderAttempt.mock.calls.map(([attempt]) => [
          attempt.outcome,
          attempt.billed,
        ]),
      ).toEqual([
        ['FINDINGS', true],
        ['PASSED', true],
      ]);
      expect(run.creditMeter.debit).toHaveBeenCalledTimes(1);
    });
  });

  describe('render findings that outlast the Repair budget', () => {
    beforeEach(() => {
      run.renderer.render.mockResolvedValue(session(recorded('safe-area')));
    });

    it('should fail RENDER_PDF as document.repair_exhausted after three sessions and two Repairs', async () => {
      await runJob(run);

      expect(lifecycle(run)).toEqual([
        'run.started',
        'step.started RESOLVE_INPUT',
        'step.completed RESOLVE_INPUT',
        'step.started GENERATE',
        'step.completed GENERATE',
        'step.started RENDER_PDF',
        'step.failed RENDER_PDF',
        'run.failed',
      ]);
      expect(
        progress(run).map(({ phase, round, session: n }) =>
          [phase, round ?? n].join(' '),
        ),
      ).toEqual([
        'draft ',
        'render 1',
        'repair 1',
        'render 2',
        'repair 2',
        'render 3',
      ]);
      expect(failedWith(run)).toMatchObject({
        code: 'document.repair_exhausted',
      });
      expect(run.renderer.render).toHaveBeenCalledTimes(3);
      expect(run.agent.repairDocument).toHaveBeenCalledTimes(2);
      expect(run.objects.put).not.toHaveBeenCalled();
      expect(run.artifacts.promoteVersion).not.toHaveBeenCalled();
    });

    it('should record every session as billed, meter three LLM turns, and commit nothing', async () => {
      await runJob(run);

      expect(run.runHandle.recordRenderAttempt).toHaveBeenCalledTimes(3);
      for (const [attempt] of run.runHandle.recordRenderAttempt.mock.calls) {
        expect(attempt).toMatchObject({ outcome: 'FINDINGS', billed: true });
      }
      expect(meterRecords(run)).toEqual(['llm', 'llm', 'llm']);
      expect(run.creditMeter.debit).not.toHaveBeenCalled();
    });
  });

  describe('truncation', () => {
    const TRUNCATED = {
      code: 'document.truncated',
      failureReason:
        'This document was too long to generate. Try fewer pages or a shorter brief.',
    };

    /** A model call that spent its turn and stopped at the token cap. */
    const cutOff = (_input: unknown, hooks?: AgentHooks): Promise<never> => {
      hooks?.onUsage?.({
        promptTokens: 4000,
        completionTokens: 16_384,
        totalTokens: 20_384,
        cost: 0.2,
        model: 'test/generation-model',
      });
      return Promise.reject(new DocumentTruncatedError('cut off'));
    };

    it('should fail as document.truncated, spending no Repair, when the draft hit the token cap', async () => {
      run.agent.generateDocument.mockImplementation(cutOff);

      await runJob(run);

      expect(lifecycle(run)).toContain('step.failed GENERATE');
      expect(failedWith(run)).toEqual(TRUNCATED);
      expect(run.artifacts.failVersion).toHaveBeenCalledWith(
        'artifact-1',
        1,
        'document.truncated',
        expect.any(String),
      );
      expect(run.agent.repairDocument).not.toHaveBeenCalled();
      expect(progress(run)).toEqual([{ step: 'GENERATE', phase: 'draft' }]);
      expect(run.runHandle.recordDocumentCheck).not.toHaveBeenCalled();
      expect(meterRecords(run)).toEqual(['llm']);
      expect(run.creditMeter.debit).not.toHaveBeenCalled();
      expect(run.renderer.render).not.toHaveBeenCalled();
    });

    it('should fail as document.truncated, spending no Repair, when the draft is over 256 KB', async () => {
      const draft = run.agent.generateDocument.getMockImplementation()!;
      run.agent.generateDocument.mockImplementation(async (input, hooks) => ({
        ...(await draft(input, hooks)),
        html: MARGIN_SAMPLE.replace(
          '</body>',
          `<p>${'x'.repeat(300_000)}</p></body>`,
        ),
      }));

      await runJob(run);

      expect(failedWith(run)).toEqual(TRUNCATED);
      expect(run.agent.repairDocument).not.toHaveBeenCalled();
      expect(progress(run)).toEqual([{ step: 'GENERATE', phase: 'draft' }]);
      const [[check]] = run.runHandle.recordDocumentCheck.mock.calls;
      expect(check.violations).toEqual([
        expect.objectContaining({ code: 'envelope.truncated' }),
      ]);
      expect(run.renderer.render).not.toHaveBeenCalled();
    });

    it('should fail as document.truncated, without another Repair, when a Repair hit the token cap', async () => {
      const draft = run.agent.generateDocument.getMockImplementation()!;
      run.agent.generateDocument.mockImplementation(async (input, hooks) => ({
        ...(await draft(input, hooks)),
        html: OFF_SCALE,
      }));
      run.agent.repairDocument.mockImplementation(cutOff);

      await runJob(run);

      expect(failedWith(run)).toEqual(TRUNCATED);
      expect(run.agent.repairDocument).toHaveBeenCalledTimes(1);
      expect(progress(run)).toEqual([
        { step: 'GENERATE', phase: 'draft' },
        { step: 'GENERATE', phase: 'repair', round: 1, violations: 1 },
      ]);
      expect(meterRecords(run)).toEqual(['llm', 'llm']);
      expect(run.creditMeter.debit).not.toHaveBeenCalled();
      expect(run.renderer.render).not.toHaveBeenCalled();
    });
  });

  describe('a render that settles on its in-step retry', () => {
    beforeEach(() => {
      run.renderer.render.mockResolvedValueOnce(
        session(
          { ...recorded('margin-sample'), timedOut: true },
          { pdf: null },
        ),
      );
    });

    it('should render again in RENDER_PDF and promote, spending no Repair', async () => {
      await expect(runJob(run)).resolves.toBeUndefined();

      expect(lifecycle(run)).toContain('step.completed RENDER_PDF');
      expect(progress(run)).toEqual([
        { step: 'GENERATE', phase: 'draft' },
        { step: 'RENDER_PDF', phase: 'render', session: 1 },
        { step: 'RENDER_PDF', phase: 'retry', cause: 'timeout' },
        { step: 'RENDER_PDF', phase: 'render', session: 2 },
      ]);
      expect(run.agent.repairDocument).not.toHaveBeenCalled();
      expect(run.artifacts.promoteVersion).toHaveBeenCalledTimes(1);
    });

    it('should absorb the timed-out session and bill only the one that passed', async () => {
      await runJob(run);

      expect(
        run.runHandle.recordRenderAttempt.mock.calls.map(([attempt]) => [
          attempt.outcome,
          attempt.billed,
        ]),
      ).toEqual([
        ['RETRY', false],
        ['PASSED', true],
      ]);
      expect(meterRecords(run)).toEqual(['llm', 'pdf_render']);
      expect(run.creditMeter.toCredits).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'pdf_render', amount: 1 }),
      );
    });
  });

  describe('a render outage that outlasts the in-step retry', () => {
    beforeEach(() => {
      run.renderer.render.mockResolvedValue(
        session(
          { ...recorded('margin-sample'), timedOut: true },
          { pdf: null },
        ),
      );
    });

    it('should leave the Attempt GENERATING while job attempts remain, absorbing both sessions', async () => {
      const error = await runJob(run, makeJob({ attemptsMade: 1 }));

      expect(error).toMatchObject({ retryable: true });
      expect(run.artifacts.failVersion).not.toHaveBeenCalled();
      expect(failedWith(run)).toBeUndefined();
      expect(run.renderer.render).toHaveBeenCalledTimes(2);
      expect(
        run.runHandle.recordRenderAttempt.mock.calls.map(([attempt]) => [
          attempt.outcome,
          attempt.billed,
        ]),
      ).toEqual([
        ['RETRY', false],
        ['RETRY', false],
      ]);
    });

    it('should checkpoint the statically clean candidate before rendering', async () => {
      await runJob(run, makeJob({ attemptsMade: 1 }));

      expect(run.runHandle.saveAcceptedCandidate).toHaveBeenCalledWith({
        candidate: MARGIN_SAMPLE,
        repairsSpent: 0,
        commentary: 'Three fixes, one per page. Swipe through.',
        title: 'Three fixes',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- an asymmetric matcher
        savedAt: expect.any(Date),
      });
    });

    it('should fail as render.unavailable when the job attempts are spent', async () => {
      await runJob(run, makeJob({ attemptsMade: 3 }));

      expect(failedWith(run)).toEqual({
        code: 'render.unavailable',
        failureReason:
          "We couldn't render your document right now. Please try again.",
      });
    });

    describe('then a job retry once Browserless recovers', () => {
      const resume = async () => {
        await runJob(run, makeJob({ attemptsMade: 1 }));
        const before = emitted(run).length;
        const llmTurns = meterRecords(run).length;
        run.renderer.render.mockResolvedValue(
          session(recorded('margin-sample')),
        );
        await runJob(run, makeJob({ attemptsMade: 2 }));
        return {
          events: emitted(run).slice(before),
          meter: meterRecords(run).slice(llmTurns),
        };
      };

      it('should resume from the checkpoint without calling the model, still announcing GENERATE', async () => {
        const { events } = await resume();

        expect(run.agent.generateDocument).toHaveBeenCalledTimes(1);
        expect(
          events
            .filter(
              ({ type }) =>
                type.startsWith('step.') && type !== 'step.progress',
            )
            .map(({ type, data }) => `${type} ${String(data.step)}`),
        ).toEqual([
          'step.started RESOLVE_INPUT',
          'step.completed RESOLVE_INPUT',
          'step.started GENERATE',
          'step.completed GENERATE',
          'step.started RENDER_PDF',
          'step.completed RENDER_PDF',
          'step.started PERSIST_VERSION',
          'step.completed PERSIST_VERSION',
        ]);
        expect(
          events
            .filter(({ type }) => type === 'step.progress')
            .map(({ data }) => data),
        ).toEqual([{ step: 'RENDER_PDF', phase: 'render', session: 1 }]);
        expect(run.artifacts.promoteVersion).toHaveBeenCalledWith(
          'artifact-1',
          1,
          expect.objectContaining({
            commentary: 'Three fixes, one per page. Swipe through.',
          }),
          { title: 'Three fixes' },
        );
      });

      it('should not re-bill the draft, and commit only the render', async () => {
        const { meter } = await resume();

        expect(meter).toEqual(['pdf_render']);
        expect(run.creditMeter.debit).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('the run deadline', () => {
    const SEVEN_MINUTES = 7 * 60 * 1000;
    let clock: number;

    beforeEach(() => {
      clock = Date.UTC(2026, 9, 2);
      jest.spyOn(Date, 'now').mockImplementation(() => clock);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    /** A draft call that takes seven minutes. */
    const slowDraft = (html: string) => {
      const draft = run.agent.generateDocument.getMockImplementation()!;
      run.agent.generateDocument.mockImplementation(async (input, hooks) => {
        clock += SEVEN_MINUTES;
        return { ...(await draft(input, hooks)), html };
      });
    };

    it('should fail as render.unavailable when it passes before a render session', async () => {
      slowDraft(MARGIN_SAMPLE);

      const error = await runJob(run, makeJob({ attemptsMade: 3 }));

      expect(error).toMatchObject({ failureCode: 'render.unavailable' });
      expect(lifecycle(run)).toContain('step.failed RENDER_PDF');
      expect(failedWith(run)).toMatchObject({ code: 'render.unavailable' });
      expect(run.renderer.render).not.toHaveBeenCalled();
    });

    it('should be transient, leaving the Attempt GENERATING while job attempts remain', async () => {
      slowDraft(MARGIN_SAMPLE);

      const error = await runJob(run, makeJob({ attemptsMade: 1 }));

      expect(error).toMatchObject({ retryable: true });
      expect(run.artifacts.failVersion).not.toHaveBeenCalled();
    });

    it('should fail as internal when it passes before a Repair in GENERATE', async () => {
      slowDraft(OFF_SCALE);

      await runJob(run, makeJob({ attemptsMade: 3 }));

      expect(lifecycle(run)).toContain('step.failed GENERATE');
      expect(failedWith(run)).toMatchObject({ code: 'internal' });
      expect(run.agent.repairDocument).not.toHaveBeenCalled();
    });
  });

  it('should fail terminally as internal and alert when the session refused a request', async () => {
    const facts = {
      ...recorded('margin-sample'),
      refusedRequests: ['https://tracker.example/pixel.png'],
    };
    run.renderer.render.mockResolvedValue(session(facts));

    await runJob(run);

    expect(failedWith(run)).toMatchObject({ code: 'internal' });
    expect(run.logger.error).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\[ALERT render\.egress\] run=run-1 artifact=artifact-1 version=\d+/,
      ),
    );
    expect(run.runHandle.recordRenderAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'EGRESS', billed: false }),
    );
  });

  it('should retry a stale contract and fail as design_system.unavailable once attempts are spent, before any spend', async () => {
    run.designSystems.resolve.mockResolvedValue({
      contract: 2,
      definition: margin,
      name: 'Margin',
    });

    await runJob(run, makeJob({ attemptsMade: 3 }));

    expect(lifecycle(run)).toContain('step.failed RESOLVE_INPUT');
    expect(failedWith(run)).toMatchObject({
      code: 'design_system.unavailable',
    });
    expect(run.agent.generateDocument).not.toHaveBeenCalled();
    expect(meterRecords(run)).toEqual([]);
  });
  describe('a refinement', () => {
    const BASE_KEY = 'artifacts/artifact-1/1/candidate.html';
    const sha256 = (body: string) =>
      createHash('sha256').update(body, 'utf8').digest('hex');

    /** v1 is the Current Version; the job refines it as v2. */
    const refineJob = (pin = { id: 'margin', version: margin.version }) =>
      makeJob({
        data: buildInput({
          kind: 'REFINE',
          version: 2,
          designSystem: pin,
        } as Partial<BuildInput>),
      });

    const baseContent = (pin = { id: 'margin', version: margin.version }) => ({
      commentary: 'The first intro.',
      document: {
        designSystemId: pin.id,
        designSystemVersion: pin.version,
        sourceKey: 'artifacts/artifact-1/1/source.html',
        sourceSha256: 'a'.repeat(64),
        candidateKey: BASE_KEY,
        candidateSha256: sha256(MARGIN_SAMPLE),
        pdfKey: 'artifacts/artifact-1/1/document.pdf',
        pageCount: 5,
      },
    });

    beforeEach(() => {
      run.artifacts.readRefineInput.mockResolvedValue({
        priorContent: baseContent(),
        feedback: 'Make page two shorter',
      });
      run.objects.get.mockResolvedValue(Buffer.from(MARGIN_SAMPLE, 'utf8'));
      run.runHandle.getLatestCompletedResearch.mockResolvedValue({
        findings: 'The first run found this.',
        sources: [],
      });
    });

    it("should carry the base's pin, rewrite its candidate.html, and promote v2 without a title", async () => {
      await expect(runJob(run, refineJob())).resolves.toBeUndefined();

      expect(lifecycle(run)).toEqual([
        'run.started',
        'step.started RESOLVE_INPUT',
        'step.completed RESOLVE_INPUT',
        'step.started GENERATE',
        'step.completed GENERATE',
        'step.started RENDER_PDF',
        'step.completed RENDER_PDF',
        'step.started PERSIST_VERSION',
        'step.completed PERSIST_VERSION',
        'run.completed',
      ]);
      expect(progress(run)).toEqual([
        { step: 'GENERATE', phase: 'draft' },
        { step: 'RENDER_PDF', phase: 'render', session: 1 },
      ]);
      expect(run.objects.get).toHaveBeenCalledWith(BASE_KEY);
      expect(run.designSystems.resolve).toHaveBeenCalledWith(
        'margin',
        margin.version,
      );

      const [[draft]] = run.agent.generateDocument.mock.calls;
      expect(draft).toMatchObject({
        includeTitle: false,
        research: { findings: 'The first run found this.' },
        refine: {
          candidate: MARGIN_SAMPLE,
          commentary: 'The first intro.',
          feedback: 'Make page two shorter',
        },
      });
      expect(draft.fragment).toContain('margin');

      expect(meterRecords(run)).toEqual(['llm', 'pdf_render']);
      expect(run.artifacts.promoteVersion).toHaveBeenCalledWith(
        'artifact-1',
        2,
        {
          commentary: 'Three fixes, one per page. Swipe through.',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- an asymmetric matcher
          document: expect.objectContaining({
            designSystemId: 'margin',
            designSystemVersion: margin.version,
            candidateKey: 'artifacts/artifact-1/2/candidate.html',
          }),
        },
        {},
      );
    });

    it("should render against the Attempt's own pin when the user switched system", async () => {
      run.artifacts.readRefineInput.mockResolvedValue({
        priorContent: baseContent({ id: 'schematic', version: 1 }),
        feedback: 'Use the margin look',
      });

      await expect(runJob(run, refineJob())).resolves.toBeUndefined();

      expect(run.designSystems.resolve).toHaveBeenCalledTimes(1);
      expect(run.designSystems.resolve).toHaveBeenCalledWith(
        'margin',
        margin.version,
      );
      expect(run.artifacts.promoteVersion).toHaveBeenCalledWith(
        'artifact-1',
        2,
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- an asymmetric matcher
          document: expect.objectContaining({ designSystemId: 'margin' }),
        }),
        {},
      );
    });

    it('should fail as design_system.unavailable on a stale contract, before reading the base or spending', async () => {
      run.designSystems.resolve.mockResolvedValue({
        contract: 2,
        definition: margin,
        name: 'Margin',
      });

      await runJob(run, makeJob({ ...refineJob(), attemptsMade: 3 }));

      expect(failedWith(run)).toMatchObject({
        code: 'design_system.unavailable',
      });
      expect(run.objects.get).not.toHaveBeenCalled();
      expect(run.agent.generateDocument).not.toHaveBeenCalled();
      expect(meterRecords(run)).toEqual([]);
    });

    it("should fail terminally as artifact.source_missing and alert when the base's candidate.html is gone", async () => {
      run.objects.get.mockResolvedValue(null);

      await runJob(run, refineJob());

      expect(lifecycle(run)).toContain('step.failed RESOLVE_INPUT');
      expect(failedWith(run)).toMatchObject({
        code: 'artifact.source_missing',
      });
      expect(run.logger.error).toHaveBeenCalledWith(
        expect.stringMatching(
          /^\[ALERT artifact\.source_missing\] run=run-1 artifact=artifact-1 version=\d+/,
        ),
      );
      expect(run.artifacts.failVersion).toHaveBeenCalledWith(
        'artifact-1',
        2,
        'artifact.source_missing',
        expect.any(String),
      );
      expect(run.agent.generateDocument).not.toHaveBeenCalled();
      expect(meterRecords(run)).toEqual([]);
    });

    it('should stay transient while job attempts remain when the R2 read fails', async () => {
      run.objects.get.mockRejectedValue(new Error('connection reset'));

      const error = await runJob(run, refineJob());

      expect(error).toMatchObject({ retryable: true });
      expect(run.artifacts.failVersion).not.toHaveBeenCalled();
    });
  });
  describe('run diagnostics', () => {
    it('should record every check, the model output, pages, sessions and step times on a READY run', async () => {
      await runJob(run);

      const { diagnostics, failedCandidate } = savedDiagnostics(run);
      expect(diagnostics).toMatchObject({
        jobAttempt: 1,
        pin: { id: 'margin', version: margin.version },
        outcome: 'READY',
        candidates: [
          {
            candidateSha256: sha(MARGIN_SAMPLE),
            checks: [
              { phase: 'static', passed: true, violations: [] },
              { phase: 'render', passed: true, violations: [] },
            ],
          },
        ],
        repairRounds: 0,
        finishReason: 'stop',
        outputTokens: 6000,
        pageCount: 5,
        renderAttempts: { sessions: 1 },
        acceptedCandidate: {
          candidateSha256: sha(MARGIN_SAMPLE),
          repairsSpent: 0,
        },
        credits: 188,
      });
      expect(Object.keys(diagnostics.stepWallTimeMs).sort()).toEqual([
        'GENERATE',
        'PERSIST_VERSION',
        'RENDER_PDF',
        'RESOLVE_INPUT',
      ]);
      expect(diagnostics).not.toHaveProperty('failureCode');
      expect(diagnostics).not.toHaveProperty('failedCandidate');
      expect(failedCandidate).toBeUndefined();
    });

    it('should log one completion line with the run summary and nothing private on a READY run', async () => {
      await runJob(run);

      expect(completionLines(run)).toEqual([
        {
          runId: 'run-1',
          artifactId: 'artifact-1',
          version: 1,
          pin: `margin@${margin.version}`,
          outcome: 'READY',
          failureCode: null,
          repairRounds: 0,
          renderSessions: 1,
          wallTimeMs: expect.any(Number),
          credits: 188,
        },
      ]);
      expectNothingPrivateLogged(run, MARGIN_SAMPLE);
    });

    describe('when static findings outlast the Repair budget', () => {
      beforeEach(() => {
        const draft = run.agent.generateDocument.getMockImplementation()!;
        run.agent.generateDocument.mockImplementation(async (input, hooks) => ({
          ...(await draft(input, hooks)),
          html: OFF_SCALE,
        }));
        const repair = run.agent.repairDocument.getMockImplementation()!;
        run.agent.repairDocument.mockImplementation(async (input, hooks) => ({
          ...(await repair(input, hooks)),
          html: OFF_SCALE,
        }));
      });

      it('should record the failing checks, the failureCode and the failed candidate', async () => {
        await runJob(run);

        const { diagnostics, failedCandidate } = savedDiagnostics(run);
        const failing = {
          phase: 'static',
          passed: false,
          violations: [{ code: 'typography.rules.minPx', count: 1 }],
        };
        expect(diagnostics).toMatchObject({
          outcome: 'FAILED',
          failureCode: 'document.repair_exhausted',
          candidates: [
            {
              candidateSha256: sha(OFF_SCALE),
              checks: [failing, failing, failing],
            },
          ],
          repairRounds: 2,
          outputTokens: 18_000,
          renderAttempts: { sessions: 0 },
          failedCandidate: { candidateSha256: sha(OFF_SCALE) },
          credits: 540,
        });
        expect(diagnostics).not.toHaveProperty('pageCount');
        expect(diagnostics).not.toHaveProperty('acceptedCandidate');
        expect(Object.keys(diagnostics.stepWallTimeMs).sort()).toEqual([
          'GENERATE',
          'RESOLVE_INPUT',
        ]);
        expect(failedCandidate).toBe(OFF_SCALE);
      });

      it('should keep one model turn per draft and Repair call, and tally each on the run', async () => {
        await runJob(run);

        const { diagnostics } = savedDiagnostics(run);
        expect(diagnostics.modelTurns.map(({ call }) => call)).toEqual([
          'draft',
          'repair',
          'repair',
        ]);
        expect(diagnostics.promptTokens).toBe(12_000);
        expect(run.runHandle.recordModelCall).toHaveBeenCalledTimes(3);
      });

      it('should log one completion line with the failureCode, and no source, brief or violation detail', async () => {
        await runJob(run);

        expect(completionLines(run)).toEqual([
          expect.objectContaining({
            outcome: 'FAILED',
            failureCode: 'document.repair_exhausted',
            repairRounds: 2,
            renderSessions: 0,
            credits: 540,
          }),
        ]);
        expectNothingPrivateLogged(run, OFF_SCALE, 'font-size: 13px');
      });
    });

    describe('when a render outage outlasts the in-step retry', () => {
      const timedOut = () =>
        session(
          { ...recorded('margin-sample'), timedOut: true },
          { pdf: null },
        );
      const timeout = {
        phase: 'render',
        passed: false,
        violations: [{ code: 'render.timeout', count: 1 }],
      };

      beforeEach(() => {
        run.renderer.render.mockResolvedValue(timedOut());
      });

      it('should save the retried job attempt as RETRYING, with its error text, and log no completion line', async () => {
        await runJob(run);

        const { diagnostics, failedCandidate } = savedDiagnostics(run);
        expect(diagnostics).toMatchObject({
          jobAttempt: 1,
          outcome: 'RETRYING',
          jobAttemptFailures: [
            {
              jobAttempt: 1,
              failureCode: 'render.unavailable',
              message: expect.stringContaining('did not settle'),
            },
          ],
          renderAttempts: { sessions: 2 },
        });
        expect(diagnostics).not.toHaveProperty('failureCode');
        expect(failedCandidate).toBeUndefined();
        expect(completionLines(run)).toEqual([]);
        expect(loggedLines(run).join('\n')).not.toContain('did not settle');
      });

      it('should describe every job attempt when a job retry resumes from the checkpoint', async () => {
        await runJob(run);
        run.renderer.render.mockResolvedValue(
          session(recorded('margin-sample')),
        );
        await runJob(run, makeJob({ attemptsMade: 1 }));

        const { diagnostics } = savedDiagnostics(run);
        expect(diagnostics).toMatchObject({
          jobAttempt: 2,
          outcome: 'READY',
          jobAttemptFailures: [
            { jobAttempt: 1, failureCode: 'render.unavailable' },
          ],
          candidates: [
            {
              candidateSha256: sha(MARGIN_SAMPLE),
              checks: [
                { phase: 'static', passed: true, violations: [] },
                timeout,
                timeout,
                { phase: 'render', passed: true, violations: [] },
              ],
            },
          ],
          finishReason: 'stop',
          outputTokens: 6000,
          renderAttempts: { sessions: 3 },
          acceptedCandidate: {
            candidateSha256: sha(MARGIN_SAMPLE),
            repairsSpent: 0,
          },
          credits: 8,
        });
        expect(completionLines(run)).toEqual([
          expect.objectContaining({ outcome: 'READY', renderSessions: 3 }),
        ]);
      });

      it('should fail with the checkpoint as the failed candidate when every session of the resumed job attempt errors', async () => {
        await runJob(run);
        run.renderer.render.mockRejectedValue(new Error('socket hang up'));
        await runJob(run, makeJob({ attemptsMade: 3 }));

        const { diagnostics, failedCandidate } = savedDiagnostics(run);
        expect(diagnostics).toMatchObject({
          outcome: 'FAILED',
          failureCode: 'render.unavailable',
          failedCandidate: { candidateSha256: sha(MARGIN_SAMPLE) },
        });
        expect(failedCandidate).toBe(MARGIN_SAMPLE);
      });

      it('should describe a job attempt that ran in another process from what the run recorded', async () => {
        await runJob(run);
        // A stalled job: the process that ran it is gone, and another one's
        // processor is told it failed for good.
        const elsewhere = new ArtifactRunProcessor(run.deps);

        await elsewhere.onFailed(
          makeJob({ attemptsMade: 3 }),
          new Error('job stalled more than allowable limit'),
        );

        const { diagnostics, failedCandidate } = savedDiagnostics(run);
        expect(diagnostics).toMatchObject({
          jobAttempt: 3,
          outcome: 'FAILED',
          failureCode: 'internal',
          jobAttemptFailures: [
            { jobAttempt: 1, failureCode: 'render.unavailable' },
            { jobAttempt: 3, failureCode: 'internal' },
          ],
          outputTokens: 6000,
          renderAttempts: { sessions: 2 },
          failedCandidate: { candidateSha256: sha(MARGIN_SAMPLE) },
          credits: 0,
        });
        expect(failedCandidate).toBe(MARGIN_SAMPLE);
        expect(completionLines(run)).toHaveLength(1);
      });
    });

    it('should record the code the run stores, internal, when the artifact was deleted mid-run', async () => {
      // The run fails as repair_exhausted, but the user deleted the artifact
      // first, so the run is failed as internal.
      run.agent.generateDocument.mockResolvedValue({
        title: 'Three fixes',
        commentary: 'Swipe through.',
        html: OFF_SCALE,
        envelopeRepairs: 0,
      });
      run.agent.repairDocument.mockResolvedValue({
        html: OFF_SCALE,
        envelopeRepairs: 0,
      });
      run.artifacts.failVersion.mockResolvedValue('ARTIFACT_DELETED');

      await runJob(run);

      expect(run.runHandle.fail).toHaveBeenCalledWith(
        'internal',
        expect.any(String),
      );
      expect(savedDiagnostics(run).diagnostics).toMatchObject({
        outcome: 'FAILED',
        failureCode: 'internal',
      });
      expect(completionLines(run)).toEqual([
        expect.objectContaining({ failureCode: 'internal' }),
      ]);
    });

    it('should record a run that failed before any check, with no failed candidate', async () => {
      run.designSystems.resolve.mockRejectedValue(
        new NotFoundException('Design System margin v1 not found'),
      );

      await runJob(run);

      const { diagnostics, failedCandidate } = savedDiagnostics(run);
      expect(diagnostics).toMatchObject({
        outcome: 'FAILED',
        failureCode: 'design_system.unavailable',
        candidates: [],
        repairRounds: 0,
      });
      expect(failedCandidate).toBeUndefined();
      expect(completionLines(run)).toHaveLength(1);
    });

    it('should still log the completion line when saving the diagnostics fails', async () => {
      run.runHandle.saveDocumentDiagnostics.mockRejectedValue(
        new Error('mongo down'),
      );

      await expect(runJob(run)).resolves.toBeUndefined();

      expect(completionLines(run)).toHaveLength(1);
      expect(run.artifacts.promoteVersion).toHaveBeenCalled();
    });
  });

  describe('alerts', () => {
    it('should alert design_system.unresolvable with the run when the pin does not resolve', async () => {
      run.designSystems.resolve.mockRejectedValue(
        new NotFoundException('Design System margin v1 not found'),
      );

      await runJob(run);

      expect(run.logger.error).toHaveBeenCalledWith(
        `[ALERT design_system.unresolvable] run=run-1 artifact=artifact-1 version=1 pin=margin@${margin.version}`,
      );
    });

    it('should alert credit.commit_failed with the run when settling a READY run fails', async () => {
      run.creditMeter.debit.mockRejectedValue(new Error('mongo down'));

      await expect(runJob(run)).resolves.toBeUndefined();

      expect(run.logger.error).toHaveBeenCalledWith(
        '[ALERT credit.commit_failed] run=run-1 artifact=artifact-1 version=1 credits=188',
      );
    });
  });
});
