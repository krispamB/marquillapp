import type { BrowserlessUsage } from './render-usage.types';

/**
 * The session failed for a reason that is not a finding: the connection
 * dropped, the protocol errored, or the PDF was unreadable. It still carries
 * the usage, because Browserless bills the session regardless.
 *
 * Its own module, so code that only classifies the failure never loads
 * `puppeteer-core`.
 */
export class RenderSessionError extends Error {
  constructor(
    message: string,
    readonly usage: BrowserlessUsage,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'RenderSessionError';
  }
}
