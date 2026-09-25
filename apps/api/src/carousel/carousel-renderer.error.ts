import type {
  BrowserlessUsage,
  RenderFailureStage,
} from './render-usage.types';

/**
 * Raised when deck assembly fails — an unknown `templateId` or a `slide.type`
 * with no registered template. Both are impossible in practice: `GENERATE`
 * validated the content against the §4 Zod union before `RENDER_PDF` runs, so a
 * cold replay would reproduce the same bad content. The `RENDER_PDF` step reads
 * this as **terminal**, distinct from a transient Browserless/R2 fault.
 *
 * Kept in its own leaf module (no Handlebars, no mongoose) so the workflow step
 * can `instanceof`-check it without pulling the template runtime into its tests.
 */
export class CarouselAssemblyError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'CarouselAssemblyError';
  }
}

/**
 * A transient render-pipeline failure that still carries the Browserless time
 * already consumed. The workflow records this attempt for provider-cost audit
 * but never sends it to the user credit meter.
 */
export class RenderAttemptError extends Error {
  constructor(
    message: string,
    readonly browserless: BrowserlessUsage,
    readonly failureStage: RenderFailureStage,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'RenderAttemptError';
  }
}
