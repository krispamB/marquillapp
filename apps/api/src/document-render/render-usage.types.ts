/** What one Browserless session cost: wall time and the whole units billed. */
export interface BrowserlessUsage {
  durationMs: number;
  units: number;
}

/**
 * The stages of one render session (§5.1), in order. A phase ends where the
 * next begins:
 *
 * - `connect` — `puppeteer.connect`: Browserless queueing and the handshake.
 * - `setup` — the page, JavaScript off, request interception, print media and
 *   the viewport.
 * - `load` — `setContent` until `load`, which waits on the font stylesheet.
 * - `probe` — the in-page probe, which waits on `document.fonts.ready`.
 * - `fontPass` — `CSS.getPlatformFontsForNode` for each text element.
 * - `cover` — the `cover.png` capture.
 * - `pdf` — `page.pdf` and the page count.
 */
export type RenderPhase =
  | 'connect'
  | 'setup'
  | 'load'
  | 'probe'
  | 'fontPass'
  | 'cover'
  | 'pdf';

/**
 * Where a session got to and how long each phase took (§11.1). `phase` is the
 * one running when the session ended: the last phase of a session that
 * finished, the phase that hung or threw otherwise. `phaseMs` holds every
 * phase the session entered, the last one up to the moment it ended.
 */
export interface RenderTrace {
  phase: RenderPhase;
  phaseMs: Partial<Record<RenderPhase, number>>;
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
export interface RenderAttemptUsage
  extends BrowserlessUsage, Partial<RenderTrace> {
  outcome: RenderSessionOutcome;
  billed: boolean;
  /** Set when the session hit its deadline; `phase` is then where it hung. */
  timedOut?: boolean;
  /** Why `cover.png` is missing, when the capture or its upload failed. */
  coverFailure?: string;
  /**
   * How long the render waited for a Browserless slot before the session
   * connected; `0` when a slot was free or the semaphore is off (M4.2).
   */
  slotWaitMs?: number;
}
