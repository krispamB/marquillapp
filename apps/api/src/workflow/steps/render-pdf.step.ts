import { setTimeout as sleep } from 'node:timers/promises';
import type { DocumentVersion } from '../../artifact/schemas';
import { RunKind } from '../../database/schemas';
import type { DesignSystemDefinition } from '../../design-system/design-system-definition';
import { judge } from '../../document-render/judge';
import { remedyOf } from '../../document-render/render-remedy';
import { RenderSessionError } from '../../document-render/render-session.error';
import type { RenderSessionResult } from '../../document-render/render-session';
import type {
  BrowserlessUsage,
  RenderAttemptUsage,
  RenderSessionOutcome,
  RenderTrace,
} from '../../document-render/render-usage.types';
import { assemble } from '../../document-source/assemble';
import { IconInliningError } from '../../document-source/icon-inlining.error';
import type { Violation } from '../../document-source/violation';
import { USAGE_KINDS } from '../../feature-gating/credit-meter.constants';
import { alert, alertSubject, type AlertSubject } from '../engine/alert';
import { RunEventType } from '../engine/run-event.types';
import { describeError, terminal, transient } from '../engine/workflow.error';
import type {
  DesignSystemPin,
  DocumentDraftState,
  RunState,
  StepContext,
  StepHandler,
} from '../engine/workflow.types';
import {
  FailureCode,
  RENDER_RETRY_DELAY_MS,
  RENDER_SLOT_WAIT_RESERVE_MS,
  WorkflowStep,
} from '../workflow.constants';
import { sha256Hex } from '../../document-source/sha256';
import {
  recordCheck,
  repair,
  repairStatically,
  type RepairedCandidate,
  type RepairScope,
} from './document-repair';

const HTML_MIME_TYPE = 'text/html; charset=utf-8';
const PDF_MIME_TYPE = 'application/pdf';
const PNG_MIME_TYPE = 'image/png';

/** The objects a Document Version keeps (spec §6.3). */
export type DocumentObject =
  | 'candidate.html'
  | 'source.html'
  | 'document.pdf'
  | 'cover.png';

/**
 * The R2 key of one of a version's objects. A whole-job retry targets the same
 * `(artifactId, version)`, so it PUTs the same keys: idempotent, no orphans.
 */
export const documentObjectKey = (
  artifactId: string,
  version: number,
  object: DocumentObject,
): string => `artifacts/${artifactId}/${version}/${object}`;

/**
 * DOCUMENT-only (spec §7.1): assemble the statically clean Candidate Source
 * into a Document Source, render it in one CDP session, and judge what the
 * session measured. On `repair` findings it spends a render Repair from the
 * budget `GENERATE` shares, statically re-checks (and, if need be, repairs)
 * the repaired Candidate Source, and renders again. On a pass it uploads
 * the four objects and puts the keys, hashes and measured `pageCount` in run
 * state for `PERSIST_VERSION`.
 *
 * Every session is recorded on the run. Only a session with a verdict is
 * billed, as one `pdf_render` record over all of them when the step completes
 * (spec §7.7).
 *
 * Before it renders a Document Source, the step saves its Candidate Source
 * to the run as the `acceptedCandidate` checkpoint (spec §7.3).
 *
 * How a judged session ends the step:
 *
 * - `render.egress` is a checker defect: **terminal**, and alerted.
 * - a `retry` finding (`render.timeout`, `render.fonts.failed`) renders the
 *   same Document Source once more after a pause, spending no Repair. If
 *   that fails too, it is **transient**: the job's own retry resumes from the
 *   checkpoint.
 * - `repair` findings with the budget spent are **terminal** as
 *   `document.repair_exhausted`.
 *
 * `DOCUMENT_RUN_DEADLINE_MS` is checked before every session and Repair.
 *
 * A session that fails outright is transient, `render.unavailable` if it ends
 * the run. A failed cover capture is recorded and never blocks the version.
 *
 * Each session first waits for a Browserless slot, at most until
 * `RENDER_SLOT_WAIT_RESERVE_MS` of the attempt is left. No slot in time is a
 * transient `render.unavailable` with no session recorded and nothing billed.
 * The retry pause and Repairs hold no slot.
 */
export const renderPdfStep: StepHandler = async (state, ctx) => {
  const { artifactId, version, kind } = state.input;
  const { designSystem, draft } = state;
  const pin = state.input.designSystem;
  if (!designSystem || !draft || !pin) {
    // RESOLVE_INPUT and GENERATE fill these before this step in every DOCUMENT
    // step list, so an empty slot is a wiring bug a replay would reproduce.
    throw terminal(
      `RENDER_PDF reached without a Design System and a Candidate Source for artifact ${artifactId} v${version}`,
    );
  }
  const { definition, fragment } = designSystem;
  const label = `artifact ${artifactId} v${version}`;
  const subject = alertSubject(ctx.run.runId, state.input);
  const scope: RepairScope = {
    ctx,
    step: WorkflowStep.RENDER_PDF,
    definition,
    fragment,
    includeTitle: kind === RunKind.INITIAL,
    label,
  };

  let current: RepairedCandidate = {
    candidate: draft.candidate,
    repairsSpent: draft.repairsSpent,
    ...(draft.fallbacksSpent !== undefined
      ? { fallbacksSpent: draft.fallbacksSpent }
      : {}),
  };
  // Sessions that produced a verdict, all billed as one record on a pass.
  const verdicts: BrowserlessUsage[] = [];
  let sessions = 0;

  /**
   * Renders and judges one Document Source until a session gives a verdict.
   * A `retry` finding renders it once more after a pause, spending no Repair.
   */
  const renderJudged = async (
    documentSource: string,
    candidate: string,
  ): Promise<JudgedSession> => {
    let retried = false;
    for (;;) {
      sessions += 1;
      ctx.deadline.assertTimeLeft(
        WorkflowStep.RENDER_PDF,
        `render session ${sessions} of ${label}`,
      );
      ctx.emit({
        type: RunEventType.STEP_PROGRESS,
        data: {
          step: WorkflowStep.RENDER_PDF,
          phase: 'render',
          session: sessions,
        },
      });

      const session = await renderSession(ctx, definition, documentSource);
      const violations = judge(definition, session.facts);
      await recordCheck(ctx, 'render', candidate, violations);

      const outcome = outcomeOf(violations);
      if (outcome === 'PASSED') return { session, violations, outcome };

      if (session.facts.timedOut) logTimeout(ctx, sessions, session.trace);
      await recordRenderAttempt(ctx, {
        ...attemptOf(session),
        outcome,
        billed: outcome === 'FINDINGS',
      });

      if (outcome === 'EGRESS') {
        alert(ctx.logger, 'render.egress', subject, {
          refused: session.refusedRequests.length,
        });
        throw terminal(
          `The Document Source for ${label} requested a refused URL`,
        );
      }
      if (outcome === 'FINDINGS') return { session, violations, outcome };

      if (retried) {
        throw transient(
          `The render of ${label} did not settle after an in-step retry (${codesOf(violations)})`,
          undefined,
          FailureCode.RENDER_UNAVAILABLE,
        );
      }
      retried = true;
      ctx.emit({
        type: RunEventType.STEP_PROGRESS,
        data: {
          step: WorkflowStep.RENDER_PDF,
          phase: 'retry',
          cause: violations.some(({ code }) => code === 'render.timeout')
            ? 'timeout'
            : 'fonts',
        },
      });
      await sleep(RENDER_RETRY_DELAY_MS);
    }
  };

  for (;;) {
    const documentSource = await assembleSource(
      ctx,
      definition,
      current.candidate,
      subject,
    );

    // The checkpoint: a job retry after a render outage resumes from here
    // without calling the model (spec §7.3).
    // Fallbacks are per job attempt, so the checkpoint does not keep them.
    await ctx.run.saveAcceptedCandidate({
      candidate: current.candidate,
      repairsSpent: current.repairsSpent,
      commentary: draft.commentary,
      ...(state.generatedTitle !== undefined
        ? { title: state.generatedTitle }
        : {}),
      savedAt: new Date(),
    });
    ctx.diagnostics.recordAccepted(current.candidate, current.repairsSpent);

    const { session, violations, outcome } = await renderJudged(
      documentSource,
      current.candidate,
    );
    if (outcome === 'PASSED') {
      return publish(ctx, {
        state,
        pin,
        draft: { ...draft, ...current },
        documentSource,
        session,
        verdicts: [...verdicts, session.usage],
      });
    }

    verdicts.push(session.usage);
    // Only `repair` findings reach the model (spec §7.2); a FINDINGS outcome
    // has no others, but the filter keeps that a guarantee.
    const findings = violations.filter(
      ({ code }) => remedyOf(code) === 'repair',
    );
    const repaired = await repair(scope, current, findings, 'render');
    // A candidate reaches Browserless only once it is statically clean.
    current = await repairStatically(scope, repaired);
  }
};

/** A session that gave a verdict: a pass, or `repair` findings. */
interface JudgedSession {
  session: RenderSessionResult;
  violations: Violation[];
  outcome: 'PASSED' | 'FINDINGS';
}

/**
 * Assembles the Document Source, with the fonts inlined when the worker could
 * fetch them and the Google Fonts `<link>` when it could not (spec §4.5). An
 * icon assembly cannot fill is terminal and alerts; the icon's name stays out
 * of the alert and in the run's failure.
 */
async function assembleSource(
  ctx: StepContext,
  definition: DesignSystemDefinition,
  candidate: string,
  subject: AlertSubject,
): Promise<string> {
  const fontCss = await ctx.fonts.inlineCss(definition, candidate);
  try {
    return assemble(definition, candidate, fontCss ?? undefined);
  } catch (error: unknown) {
    if (error instanceof IconInliningError) {
      alert(ctx.logger, error.alertTag, subject);
      throw terminal(error.message, error);
    }
    throw error;
  }
}

/**
 * What a session reports about itself for the run's `renderAttempts` entry:
 * its usage, the phase it reached and the time each phase took, and whether
 * it hit its deadline (§11.1).
 */
function attemptOf({
  usage,
  trace,
  facts,
  slotWaitMs,
}: RenderSessionResult): Omit<RenderAttemptUsage, 'outcome' | 'billed'> {
  return {
    ...usage,
    ...trace,
    ...(facts.timedOut ? { timedOut: true } : {}),
    ...(slotWaitMs !== undefined ? { slotWaitMs } : {}),
  };
}

/**
 * Logs where a timed-out session hung (§11.6): the run, the phases and their
 * times, never the Candidate Source or the Document Source.
 */
function logTimeout(
  ctx: StepContext,
  session: number,
  { phase, phaseMs }: RenderTrace,
): void {
  ctx.logger.warn(
    `render.timeout run=${ctx.run.runId} session=${session} phase=${phase} phaseMs=${JSON.stringify(phaseMs)}`,
  );
}

/**
 * Records one render session on the run, and counts it in the run's
 * diagnostics, which refer to these entries rather than copy them.
 */
async function recordRenderAttempt(
  ctx: StepContext,
  usage: RenderAttemptUsage,
): Promise<void> {
  await ctx.run.recordRenderAttempt(usage);
  ctx.diagnostics.recordRenderSession();
}

/**
 * One render session. A session that fails outright is recorded, unbilled.
 * A render that got no Browserless slot ran no session, so nothing is recorded.
 */
async function renderSession(
  ctx: StepContext,
  definition: DesignSystemDefinition,
  documentSource: string,
): Promise<RenderSessionResult> {
  try {
    return await ctx.renderer.render(definition, documentSource, {
      maxSlotWaitMs: ctx.deadline.remainingMs(RENDER_SLOT_WAIT_RESERVE_MS),
    });
  } catch (error: unknown) {
    if (error instanceof RenderSessionError) {
      await recordRenderAttempt(ctx, {
        ...error.usage,
        ...error.trace,
        ...(error.slotWaitMs !== undefined
          ? { slotWaitMs: error.slotWaitMs }
          : {}),
        outcome: 'ERROR',
        billed: false,
      });
      throw transient(error.message, error, FailureCode.RENDER_UNAVAILABLE);
    }
    throw transient(
      error instanceof Error ? error.message : String(error),
      error,
      FailureCode.RENDER_UNAVAILABLE,
    );
  }
}

interface Publication {
  state: RunState;
  pin: DesignSystemPin;
  /** The Candidate Source that passed, with the Repairs spent reaching it. */
  draft: DocumentDraftState;
  documentSource: string;
  /** The session that passed. */
  session: RenderSessionResult;
  /** Every session with a verdict, the passing one included. */
  verdicts: BrowserlessUsage[];
}

/**
 * Uploads a passing render's objects, records its session, and bills every
 * session with a verdict as one `pdf_render` record.
 */
async function publish(
  ctx: StepContext,
  { state, pin, draft, documentSource, session, verdicts }: Publication,
): Promise<Partial<RunState>> {
  const { artifactId, version } = state.input;
  const recordSession = (coverFailure?: string) =>
    recordRenderAttempt(ctx, {
      ...attemptOf(session),
      outcome: 'PASSED',
      billed: true,
      ...(coverFailure !== undefined ? { coverFailure } : {}),
    });

  const { pdf, pageCount } = session;
  if (!pdf || pageCount === null) {
    // A judged pass always printed; a session that did not is a defect.
    await recordSession();
    throw transient(
      `The render of artifact ${artifactId} v${version} passed without a PDF`,
      undefined,
      FailureCode.RENDER_UNAVAILABLE,
    );
  }

  const keyOf = (object: DocumentObject) =>
    documentObjectKey(artifactId, version, object);
  const candidateKey = keyOf('candidate.html');
  const sourceKey = keyOf('source.html');
  const pdfKey = keyOf('document.pdf');

  // Written before promotion, so a READY version always has its objects.
  await ctx.objects.put(
    candidateKey,
    Buffer.from(draft.candidate, 'utf8'),
    HTML_MIME_TYPE,
  );
  await ctx.objects.put(
    sourceKey,
    Buffer.from(documentSource, 'utf8'),
    HTML_MIME_TYPE,
  );
  // The PDF and the cover upload together. The cover keeps its own catch, so
  // its failure is reported as `coverFailure` and never fails the PDF.
  const uploadCover = async (): Promise<{
    coverKey?: string;
    coverFailure?: string;
  }> => {
    if (!session.cover.ok) return { coverFailure: session.cover.reason };
    try {
      await ctx.objects.put(
        keyOf('cover.png'),
        Buffer.from(session.cover.png),
        PNG_MIME_TYPE,
      );
      return { coverKey: keyOf('cover.png') };
    } catch (error: unknown) {
      return {
        coverFailure: `upload failed: ${describeError(error)}`,
      };
    }
  };
  const [, { coverKey, coverFailure }] = await Promise.all([
    ctx.objects.put(pdfKey, Buffer.from(pdf), PDF_MIME_TYPE),
    uploadCover(),
  ]);
  if (coverFailure !== undefined) {
    ctx.logger.warn(
      `cover.png missing for artifact ${artifactId} v${version}: ${coverFailure}`,
    );
  }

  await recordSession(coverFailure);
  ctx.diagnostics.recordPageCount(pageCount);

  // One record per run over every session with a verdict, so the meter's
  // `max(minimum, surcharge × units)` applies the minimum once (spec §7.7).
  const billed = verdicts.reduce(
    (total, usage) => ({
      durationMs: total.durationMs + usage.durationMs,
      units: total.units + usage.units,
    }),
    { durationMs: 0, units: 0 },
  );
  ctx.meter.record({
    kind: USAGE_KINDS.PDF_RENDER,
    amount: billed.units,
    detail: { browserless: billed },
  });

  const document: DocumentVersion = {
    designSystemId: pin.id,
    designSystemVersion: pin.version,
    sourceKey,
    sourceSha256: sha256Hex(documentSource),
    candidateKey,
    candidateSha256: sha256Hex(draft.candidate),
    pdfKey,
    pageCount,
    ...(coverKey !== undefined ? { coverKey } : {}),
  };
  return { draft, document };
}

/** How a judged session ended, by the strongest remedy among its findings. */
function outcomeOf(violations: Violation[]): RenderSessionOutcome {
  const remedies = new Set(violations.map(({ code }) => remedyOf(code)));
  if (remedies.has('defect')) return 'EGRESS';
  if (remedies.has('retry')) return 'RETRY';
  if (remedies.has('repair')) return 'FINDINGS';
  return 'PASSED';
}

const codesOf = (violations: Violation[]): string =>
  [...new Set(violations.map(({ code }) => code))].join(', ');
