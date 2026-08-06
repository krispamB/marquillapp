import { LLMError } from '../../llm/errors';

/**
 * The engine's failure taxonomy. `retryable` decides whether a failure rides
 * BullMQ's `attempts: 3` budget or stops the job dead.
 *
 * A retry re-runs the *whole* job from step 1 — there are no per-step
 * checkpoints — so `retryable: true` must mean "a cold replay could plausibly
 * succeed". Anything a replay cannot fix (a missing artifact, output that
 * failed Zod even after the generator's own repair retry) is terminal.
 */
export class WorkflowError extends Error {
  readonly retryable: boolean;
  readonly reason: string;

  constructor(
    reason: string,
    options: { retryable: boolean; cause?: unknown },
  ) {
    super(reason, { cause: options.cause });
    this.name = 'WorkflowError';
    this.reason = reason;
    this.retryable = options.retryable;
  }
}

/** Anything can be thrown; only an `Error` is guaranteed to carry a message. */
export const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** A cold replay cannot fix this. Stops retries immediately. */
export const terminal = (reason: string, cause?: unknown): WorkflowError =>
  new WorkflowError(reason, { retryable: false, cause });

/** A cold replay might succeed. Rides the attempt budget. */
export const transient = (reason: string, cause?: unknown): WorkflowError =>
  new WorkflowError(reason, { retryable: true, cause });

/**
 * Normalize anything a step throws into a `WorkflowError`.
 *
 * Unclassified errors default to **retryable**, matching BullMQ's own posture
 * that a thrown error is worth another attempt: terminal is the deliberate
 * choice a step opts into, never something inferred from silence. A retried
 * attempt debits no credits, so the cost of guessing wrong here is latency.
 */
export const toWorkflowError = (error: unknown): WorkflowError => {
  if (error instanceof WorkflowError) return error;

  // The LLM layer already knows which provider faults are worth replaying.
  if (error instanceof LLMError) {
    return new WorkflowError(error.message, {
      retryable: error.retryable,
      cause: error,
    });
  }

  const message =
    error instanceof Error && error.message.length > 0
      ? error.message
      : 'Workflow step failed';

  return new WorkflowError(message, { retryable: true, cause: error });
};
