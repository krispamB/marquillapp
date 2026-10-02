import type { DocumentVersion } from '../../artifact/schemas';
import { judge } from '../../document-render/judge';
import { remedyOf } from '../../document-render/render-remedy';
import { RenderSessionError } from '../../document-render/render-session.error';
import type { RenderSessionResult } from '../../document-render/render-session';
import type { RenderSessionOutcome } from '../../document-render/render-usage.types';
import { assemble } from '../../document-source/assemble';
import { IconInliningError } from '../../document-source/icon-inlining.error';
import type { Violation } from '../../document-source/violation';
import { USAGE_KINDS } from '../../feature-gating/credit-meter.constants';
import { RunEventType } from '../engine/run-event.types';
import { terminal, transient } from '../engine/workflow.error';
import type { StepHandler } from '../engine/workflow.types';
import { FailureCode, WorkflowStep } from '../workflow.constants';
import { sha256Hex } from '../../document-source/sha256';

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
 * into a Document Source, render it in one CDP session, judge what the
 * session measured, and, on a pass, upload the four objects. Puts the keys,
 * hashes and measured `pageCount` in run state for `PERSIST_VERSION`.
 *
 * Every session is recorded on the run. Only a session with a verdict is
 * billed, as one `pdf_render` record when the step completes (spec §7.7).
 *
 * There is no Repair yet (#168). How a judged session ends the step:
 *
 * - `render.egress` is a checker defect: **terminal**, and alerted.
 * - a `retry` finding (`render.timeout`, `render.fonts.failed`) is
 *   **transient**: the job's own retry renders again.
 * - any `repair` finding is **terminal** as `document.repair_exhausted`.
 *
 * A session that fails outright is transient, `render.unavailable` if it ends
 * the run. A failed cover capture is recorded and never blocks the version.
 */
export const renderPdfStep: StepHandler = async (state, ctx) => {
  const { artifactId, version } = state.input;
  const { designSystem, draft } = state;
  const pin = state.input.designSystem;
  if (!designSystem || !draft || !pin) {
    // RESOLVE_INPUT and GENERATE fill these before this step in every DOCUMENT
    // step list, so an empty slot is a wiring bug a replay would reproduce.
    throw terminal(
      `RENDER_PDF reached without a Design System and a Candidate Source for artifact ${artifactId} v${version}`,
    );
  }
  const { definition } = designSystem;

  let documentSource: string;
  try {
    documentSource = assemble(definition, draft.candidate);
  } catch (error: unknown) {
    if (error instanceof IconInliningError) {
      throw terminal(error.message, error);
    }
    throw error;
  }

  ctx.emit({
    type: RunEventType.STEP_PROGRESS,
    data: { step: WorkflowStep.RENDER_PDF, phase: 'render', session: 1 },
  });

  let session: RenderSessionResult;
  try {
    session = await ctx.renderer.render(definition, documentSource);
  } catch (error: unknown) {
    if (error instanceof RenderSessionError) {
      await ctx.run.recordRenderAttempt({
        ...error.usage,
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

  const violations = judge(definition, session.facts);
  await ctx.run.recordDocumentCheck({
    phase: 'render',
    candidateSha256: sha256Hex(draft.candidate),
    violations,
    checkedAt: new Date(),
  });

  const outcome = outcomeOf(violations);
  const recordSession = (coverFailure?: string) =>
    ctx.run.recordRenderAttempt({
      ...session.usage,
      outcome,
      billed: outcome === 'PASSED' || outcome === 'FINDINGS',
      ...(coverFailure !== undefined ? { coverFailure } : {}),
    });

  if (outcome === 'EGRESS') {
    await recordSession();
    ctx.logger.error(
      `[ALERT render.egress] artifact ${artifactId} v${version}: the render session refused ${session.refusedRequests.length} request(s) the static check let through`,
    );
    throw terminal(
      `The Document Source for artifact ${artifactId} v${version} requested a refused URL`,
    );
  }
  if (outcome === 'RETRY') {
    await recordSession();
    throw transient(
      `The render of artifact ${artifactId} v${version} did not settle (${codesOf(violations)})`,
      undefined,
      FailureCode.RENDER_UNAVAILABLE,
    );
  }
  if (outcome === 'FINDINGS') {
    await recordSession();
    throw terminal(
      `The render of artifact ${artifactId} v${version} has ${violations.length} finding(s), and there is no Repair`,
      undefined,
      FailureCode.DOCUMENT_REPAIR_EXHAUSTED,
    );
  }

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
  await ctx.objects.put(pdfKey, Buffer.from(pdf), PDF_MIME_TYPE);

  let coverKey: string | undefined;
  let coverFailure: string | undefined;
  if (session.cover.ok) {
    try {
      await ctx.objects.put(
        keyOf('cover.png'),
        Buffer.from(session.cover.png),
        PNG_MIME_TYPE,
      );
      coverKey = keyOf('cover.png');
    } catch (error: unknown) {
      coverFailure = `upload failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  } else {
    coverFailure = session.cover.reason;
  }
  if (coverFailure !== undefined) {
    ctx.logger.warn(
      `cover.png missing for artifact ${artifactId} v${version}: ${coverFailure}`,
    );
  }

  await recordSession(coverFailure);

  // One record per run, over every session with a verdict. With no Repair
  // there is exactly one such session: this one.
  ctx.meter.record({
    kind: USAGE_KINDS.PDF_RENDER,
    amount: session.usage.units,
    detail: { browserless: session.usage },
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
  return { document };
};

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
