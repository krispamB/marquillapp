/** What one Browserless session cost: wall time and the whole units billed. */
export interface BrowserlessUsage {
  durationMs: number;
  units: number;
}

/**
 * How one render session ended (§7.7):
 *
 * - `PASSED` — the judge found nothing; the session produced the PDF.
 * - `FINDINGS` — the judge returned `repair` findings: a verdict, but a reject.
 * - `RETRY` — a `retry` finding (`render.timeout`, `render.fonts.failed`).
 * - `EGRESS` — the session refused a request: a checker defect.
 * - `ERROR` — the session itself failed (connection, protocol, unreadable PDF).
 */
export type RenderSessionOutcome =
  | 'PASSED'
  | 'FINDINGS'
  | 'RETRY'
  | 'EGRESS'
  | 'ERROR';

/**
 * One entry in a run's `renderAttempts`. Every session is recorded; only a
 * session with a verdict (`PASSED` or `FINDINGS`) is `billed`. The others are
 * absorbed.
 */
export interface RenderAttemptUsage extends BrowserlessUsage {
  outcome: RenderSessionOutcome;
  billed: boolean;
  /** Why `cover.png` is missing, when the capture or its upload failed. */
  coverFailure?: string;
}
