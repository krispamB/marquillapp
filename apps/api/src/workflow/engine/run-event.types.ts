export enum RunEventType {
  RUN_STARTED = 'run.started',
  STEP_STARTED = 'step.started',
  STEP_COMPLETED = 'step.completed',
  STEP_FAILED = 'step.failed',
  STEP_PROGRESS = 'step.progress',
  USAGE_TICK = 'usage.tick',
  RUN_COMPLETED = 'run.completed',
  RUN_FAILED = 'run.failed',
}

/** What a producer supplies. The core stamps `runId`, `seq`, and `ts`. */
export interface EmittedEvent {
  type: RunEventType;
  data: Record<string, unknown>;
}

export interface RunEvent extends EmittedEvent {
  runId: string;
  /** Monotonic per-run, starting at 1. Assigned by the core, never by a step. */
  seq: number;
  ts: number;
}

/**
 * The two end-of-stream signals. There is deliberately no bespoke `end` event —
 * these already are it, and the SSE client closes on either.
 */
export const TERMINAL_RUN_EVENTS: ReadonlySet<RunEventType> = new Set([
  RunEventType.RUN_COMPLETED,
  RunEventType.RUN_FAILED,
]);

export const isTerminalRunEvent = (type: RunEventType): boolean =>
  TERMINAL_RUN_EVENTS.has(type);

export const runEventStreamKey = (runId: string): string =>
  `workflow:run:${runId}`;

/** A run emits well under this; the cap is a safety valve, not retention. */
export const RUN_EVENT_STREAM_MAXLEN = 1000;

/** Long enough for a client reconnecting shortly after a run to replay it. */
export const RUN_EVENT_STREAM_TTL_SECONDS = 3600;
