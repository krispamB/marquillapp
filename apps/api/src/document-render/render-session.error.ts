import type { BrowserlessUsage, RenderTrace } from './render-usage.types';

/**
 * The session failed for a reason that is not a finding: the connection
 * dropped, the protocol errored, or the PDF was unreadable. It still carries
 * the usage, because Browserless bills the session regardless, and the trace
 * of the phase it failed in.
 *
 * Its own module, so code that only classifies the failure never loads
 * `puppeteer-core`.
 */
export class RenderSessionError extends Error {
  readonly trace?: RenderTrace;
  /** How long the render waited for a Browserless slot; set by the renderer. */
  slotWaitMs?: number;

  constructor(
    message: string,
    readonly usage: BrowserlessUsage,
    options?: { cause?: unknown; trace?: RenderTrace },
  ) {
    super(
      message,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.trace = options?.trace;
    this.name = 'RenderSessionError';
  }
}
