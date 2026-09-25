/**
 * A provider-agnostic LLM failure.
 *
 * `retryable` is decided here, in the LLM layer, because only this layer knows
 * provider error semantics. Callers above it (the agent loop, the workflow
 * engine) branch on the flag without knowing what a 429 is.
 */
export class LLMError extends Error {
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(
    message: string,
    options: { retryable: boolean; statusCode?: number; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = 'LLMError';
    this.retryable = options.retryable;
    this.statusCode = options.statusCode;
  }
}

/**
 * Transport-level failures where the request never got a verdict from the
 * provider, so replaying it is safe. `RequestAbortedError` is excluded: an
 * abort is the caller's own decision, not a fault to retry through.
 */
const RETRYABLE_TRANSPORT_ERRORS = new Set([
  'ConnectionError',
  'RequestTimeoutError',
]);

const isRetryableStatus = (statusCode: number): boolean =>
  statusCode === 408 || statusCode === 429 || statusCode >= 500;

const readStatusCode = (error: unknown): number | undefined => {
  const statusCode = (error as { statusCode?: unknown })?.statusCode;
  return typeof statusCode === 'number' ? statusCode : undefined;
};

const readMessage = (error: unknown, fallback: string): string => {
  const message = (error as { message?: unknown })?.message;
  return typeof message === 'string' && message.length > 0 ? message : fallback;
};

/**
 * Normalize anything thrown by a provider SDK into an `LLMError`.
 *
 * Matches structurally rather than with `instanceof` against the SDK's error
 * classes: a duplicated copy of the package in the module graph would defeat
 * `instanceof`, and every one of those classes exposes `statusCode` or `name`.
 */
export const toLLMError = (error: unknown): LLMError => {
  if (error instanceof LLMError) return error;

  const statusCode = readStatusCode(error);
  if (statusCode !== undefined) {
    return new LLMError(
      readMessage(error, `Provider request failed with status ${statusCode}`),
      { retryable: isRetryableStatus(statusCode), statusCode, cause: error },
    );
  }

  const name = (error as { name?: unknown })?.name;
  const retryable =
    typeof name === 'string' && RETRYABLE_TRANSPORT_ERRORS.has(name);

  return new LLMError(readMessage(error, 'Provider request failed'), {
    retryable,
    cause: error,
  });
};
