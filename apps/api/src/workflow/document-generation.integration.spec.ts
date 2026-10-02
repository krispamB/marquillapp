import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
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
import type { BuildInput, DocumentCheck } from './engine/workflow.types';
import { ArtifactRunProcessor } from './workers/artifact-run.worker.handler';

/**
 * Test layer 3 (spec §11.2): a DOCUMENT run through the real worker
 * processor, engine, steps, checker, assembly and judge, with a scripted fake
 * agent and renderer. The renderer replays probe facts the real session
 * recorded (`test:render`), so the judge decides on real measurements.
 *
 * There is no render Repair yet (#168), so the paths are: clean; a static
 * Repair that succeeds; static Repairs that run out; a render finding;
 * truncation; a render that must be retried; egress; and a stale contract.
 * Each asserts step events, `step.progress`, meter records and `failureCode`.
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
    attemptsMade: 1,
    opts: { attempts: 3 },
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
  };
  const agent = {
    generate: jest.fn(),
    research: jest.fn(),
    generateDocument: jest.fn(
      (
        _input: DocumentGenerateInput,
        hooks?: AgentHooks,
      ): Promise<DocumentDraftResult> => {
        hooks?.onUsage?.(turn);
        return Promise.resolve({
          title: 'Three fixes',
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
        hooks?.onUsage?.(turn);
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
  };
  const runHandle = {
    runId: 'run-1',
    setCurrentStep: jest.fn().mockResolvedValue(undefined),
    saveResearchContext: jest.fn().mockResolvedValue(undefined),
    recordRenderAttempt: jest.fn().mockResolvedValue(undefined),
    recordDocumentCheck: jest
      .fn<Promise<void>, [DocumentCheck]>()
      .mockResolvedValue(undefined),
    getLatestCompletedResearch: jest.fn(),
    complete: jest.fn().mockResolvedValue(undefined),
    fail: jest.fn().mockResolvedValue(undefined),
  };
  const creditMeter = {
    assertBalance: jest.fn().mockResolvedValue(undefined),
    toCredits: jest.fn((usage: { kind: string }) =>
      usage.kind === 'pdf_render' ? 8 : 180,
    ),
    debit: jest.fn().mockResolvedValue(undefined),
  };

  const processor = new ArtifactRunProcessor({
    agent: agent as never,
    artifacts: artifacts as never,
    designSystems: designSystems as never,
    renderer: renderer as never,
    objects,
    creditMeter: creditMeter as never,
    featureGating: { assertResearchAccess: jest.fn() } as never,
    runs: { handleFor: jest.fn().mockReturnValue(runHandle) } as never,
    redis: redis as never,
    logger,
  });

  return {
    processor,
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

  describe('a render finding, with no Repair yet', () => {
    beforeEach(() => {
      run.renderer.render.mockResolvedValue(session(recorded('safe-area')));
    });

    it('should fail RENDER_PDF as document.repair_exhausted with a billed session and nothing uploaded', async () => {
      await runJob(run);

      expect(lifecycle(run)).toContain('step.failed RENDER_PDF');
      expect(failedWith(run)).toMatchObject({
        code: 'document.repair_exhausted',
      });
      expect(run.runHandle.recordRenderAttempt).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'FINDINGS', billed: true }),
      );
      expect(run.objects.put).not.toHaveBeenCalled();
      expect(run.artifacts.promoteVersion).not.toHaveBeenCalled();
      expect(run.creditMeter.debit).not.toHaveBeenCalled();
    });
  });

  it('should fail as document.truncated when the draft hit the token cap', async () => {
    run.agent.generateDocument.mockRejectedValue(
      new DocumentTruncatedError('cut off'),
    );

    await runJob(run);

    expect(failedWith(run)).toEqual({
      code: 'document.truncated',
      failureReason:
        'This document was too long to generate. Try fewer pages or a shorter brief.',
    });
    expect(run.renderer.render).not.toHaveBeenCalled();
  });

  describe('a render that must be retried', () => {
    beforeEach(() => {
      run.renderer.render.mockResolvedValue(
        session(
          { ...recorded('margin-sample'), timedOut: true },
          { pdf: null },
        ),
      );
    });

    it('should leave the Attempt GENERATING while job attempts remain, absorbing the session', async () => {
      const error = await runJob(run, makeJob({ attemptsMade: 1 }));

      expect(error).toMatchObject({ retryable: true });
      expect(run.artifacts.failVersion).not.toHaveBeenCalled();
      expect(failedWith(run)).toBeUndefined();
      expect(run.runHandle.recordRenderAttempt).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'RETRY', billed: false }),
      );
    });

    it('should fail as render.unavailable when the job attempts are spent', async () => {
      await runJob(run, makeJob({ attemptsMade: 3 }));

      expect(failedWith(run)).toEqual({
        code: 'render.unavailable',
        failureReason:
          "We couldn't render your document right now. Please try again.",
      });
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
      expect.stringContaining('[ALERT render.egress]'),
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
});
