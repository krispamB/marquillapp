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
  /** How long the provider asked us to wait (`Retry-After`), when it did. */
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    options: {
      retryable: boolean;
      statusCode?: number;
      retryAfterMs?: number;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = 'LLMError';
    this.retryable = options.retryable;
    this.statusCode = options.statusCode;
    this.retryAfterMs = options.retryAfterMs;
  }
}

/**
 * Transport-level failures where the request never got a verdict from the
 * provider, so replaying it is safe. A raw `TimeoutError` is a timeout that
 * fired while the SDK read the body, outside its own error mapping.
 * `RequestAbortedError` and a raw `AbortError` are excluded: an abort is the
 * caller's own decision, not a fault to retry through.
 */
const RETRYABLE_TRANSPORT_ERRORS = new Set([
  'ConnectionError',
  'RequestTimeoutError',
  'TimeoutError',
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
 * `Retry-After` as delta-seconds or an HTTP date, in milliseconds from now.
 * The SDK's `OpenRouterError` keeps the response `headers`. Absent, malformed
 * or already past is `undefined`.
 */
const readRetryAfterMs = (error: unknown): number | undefined => {
  const headers = (error as { headers?: unknown })?.headers;
  if (!(headers instanceof Headers)) return undefined;
  const value = headers.get('retry-after')?.trim();
  if (!value) return undefined;

  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  const delta = at - Date.now();
  return delta > 0 ? delta : undefined;
};

/** The body's `{ error: { code, message } }`, from the parsed value or the raw text. */
const readEmbeddedError = (
  error: unknown,
): { code?: unknown; message?: unknown } | undefined => {
  const { rawValue, body } = error as { rawValue?: unknown; body?: unknown };
  let value = rawValue;
  if (value === undefined && typeof body === 'string') {
    try {
      value = JSON.parse(body) as unknown;
    } catch {
      return undefined;
    }
  }
  const embedded = (value as { error?: unknown })?.error;
  return typeof embedded === 'object' && embedded !== null
    ? (embedded as { code?: unknown; message?: unknown })
    : undefined;
};

/**
 * A provider failure after `200 OK`: OpenRouter has already sent the status,
 * so the error arrives in the body and the SDK reports a
 * `ResponseValidationError` with `statusCode 200`. The body's `error.code`
 * carries the real verdict. A body we cannot read is retryable: a resample of
 * the same request is the likeliest way out.
 */
const fromEmbeddedError = (error: unknown): LLMError => {
  const embedded = readEmbeddedError(error);
  const rawCode = embedded?.code;
  const code =
    typeof rawCode === 'number'
      ? rawCode
      : typeof rawCode === 'string' && /^\d+$/.test(rawCode)
        ? Number(rawCode)
        : undefined;
  const message =
    typeof embedded?.message === 'string' && embedded.message.length > 0
      ? embedded.message
      : readMessage(error, 'Provider failed after 200 OK');

  if (code === undefined) {
    return new LLMError(message, {
      retryable: true,
      statusCode: 200,
      cause: error,
    });
  }
  return new LLMError(message, {
    retryable: isRetryableStatus(code),
    statusCode: code,
    cause: error,
  });
};

/**
 * A provider failure in the middle of a stream: the status was already
 * `200 OK`, so the error arrives as a chunk's `error`, and its `code` carries
 * the verdict as an HTTP status would. A code that is not an error status is
 * retryable, as an unreadable code after `200 OK` is.
 */
export const fromStreamError = (error: {
  code: number;
  message: string;
}): LLMError =>
  new LLMError(error.message || 'Provider failed mid-stream', {
    retryable: error.code < 400 || isRetryableStatus(error.code),
    statusCode: error.code,
  });

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
  if (statusCode === 200) return fromEmbeddedError(error);
  if (statusCode !== undefined) {
    const retryAfterMs = readRetryAfterMs(error);
    return new LLMError(
      readMessage(error, `Provider request failed with status ${statusCode}`),
      {
        retryable: isRetryableStatus(statusCode),
        statusCode,
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
        cause: error,
      },
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
