import type { CarouselTheme } from '../../database/schemas';
import type { Slide } from '../../carousel/schemas';
import {
  CarouselAssemblyError,
  RenderAttemptError,
} from '../../carousel/carousel-renderer.error';
import { USAGE_KINDS } from '../../feature-gating/credit-meter.constants';
import { terminal } from '../engine/workflow.error';
import type { StepHandler } from '../engine/workflow.types';

/**
 * The render-relevant slice of DOCUMENT content. The full arm joins the §4 Zod
 * union in T11 (#122); `RENDER_PDF` needs only `templateId` + `slides`, and reads
 * them structurally so it compiles — and renders — ahead of that arm landing.
 */
interface DocumentRenderContent {
  document: { templateId: CarouselTheme; slides: Slide[] };
}

/**
 * DOCUMENT-only: turns the generated slides into a PDF in R2 via
 * `ctx.renderer.render(...)` (R3), which owns `assembleHtml → htmlToPdf →
 * uploadFile`. Writes `render = { pdfKey, pageCount }` (R1 — the key, never a URL,
 * since the R2 bucket is private) for `PERSIST_VERSION` to fold in.
 *
 * Emits **no** `step.progress` (R7): the render is one atomic `htmlToPdf` call
 * with nothing observable between request and buffer. Bills exactly one
 * `pdf_render` surcharge (R5) on success.
 *
 * Failure arms:
 * - A Browserless timeout / R2 fault is **retryable** — it propagates unwrapped
 *   and the engine's default classification rides the attempt budget.
 * - An unknown `templateId`/`slide.type` at assembly is **terminal**: Zod already
 *   validated the content at `GENERATE`, so it cannot occur, and a cold replay
 *   cannot fix it.
 */
export const renderPdfStep: StepHandler = async (state, ctx) => {
  const { artifactId, version } = state.input;

  const content = state.content as Partial<DocumentRenderContent> | undefined;
  const document = content?.document;
  if (!document) {
    // GENERATE writes DOCUMENT content before this in every step list the builder
    // emits, so an empty slot is a wiring bug a replay would reproduce exactly.
    throw terminal(
      `RENDER_PDF reached without DOCUMENT content for artifact ${artifactId} v${version}`,
    );
  }

  try {
    const render = await ctx.renderer.render({
      artifactId,
      version,
      templateId: document.templateId,
      slides: document.slides,
    });
    await ctx.run.recordRenderAttempt({
      ...render.browserless,
      outcome: 'SUCCEEDED',
    });
    ctx.meter.record({
      kind: USAGE_KINDS.PDF_RENDER,
      amount: render.browserless.units,
      detail: {
        browserless: render.browserless,
      },
    });
    return { render };
  } catch (error: unknown) {
    if (error instanceof RenderAttemptError) {
      await ctx.run.recordRenderAttempt({
        ...error.browserless,
        outcome: 'FAILED',
        failureStage: error.failureStage,
      });
      throw error;
    }
    if (error instanceof CarouselAssemblyError) {
      throw terminal(error.message, error);
    }
    throw error;
  }
};
