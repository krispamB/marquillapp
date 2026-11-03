import type { Logger } from '@nestjs/common';
import { readIntEnv, type EnvSource } from '../../common/env';
import { LLMError, toLLMError } from '../errors';
import type { CompletionOptions } from '../interfaces';

/**
 * How a strategy retries one call. Provider SDK retries stay off: they share
 * one timeout across every try and skip 429s, so this loop owns both.
 */
export interface RetryPolicy {
  /** The longest one try may take. A call may ask for less, never more. */
  timeoutMs: number;
  /** Tries per call, the first included. `1` turns retrying off. */
  maxAttempts: number;
  /** The jitter ceiling of the first retry; it doubles on each one after. */
  baseMs: number;
  /** The jitter ceiling never grows past this. */
  maxDelayMs: number;
  /**
   * The most one call may spend sleeping between tries, `Retry-After`
   * included. A sleep that would pass it ends the call with its last error.
   */
  budgetMs: number;
}

/**
 * Reads the `<prefix>_*` retry keys (`OPENROUTER_TIMEOUT_MS`,
 * `ANTHROPIC_MAX_ATTEMPTS`, ...). Every provider has the same defaults. A bad
 * value throws, naming the key.
 */
export const readRetryPolicy = (
  source: EnvSource,
  prefix: 'OPENROUTER' | 'ANTHROPIC' = 'OPENROUTER',
): RetryPolicy => ({
  timeoutMs: readIntEnv(source, `${prefix}_TIMEOUT_MS`, {
    default: 240_000,
    min: 1,
  }),
  maxAttempts: readIntEnv(source, `${prefix}_MAX_ATTEMPTS`, {
    default: 3,
    min: 1,
  }),
  baseMs: readIntEnv(source, `${prefix}_RETRY_BASE_MS`, { default: 1_000 }),
  maxDelayMs: readIntEnv(source, `${prefix}_RETRY_MAX_DELAY_MS`, {
    default: 15_000,
  }),
  budgetMs: readIntEnv(source, `${prefix}_RETRY_BUDGET_MS`, {
    default: 45_000,
  }),
});

/**
 * Full jitter before retry `retry` (0 for the first): a uniform draw from
 * `[0, min(maxDelayMs, baseMs * 2^retry))`.
 */
export const jitterMs = (
  policy: RetryPolicy,
  retry: number,
  random: () => number = Math.random,
): number =>
  Math.floor(
    random() * Math.min(policy.maxDelayMs, policy.baseMs * 2 ** retry),
  );

/** Resolves after `ms`, or rejects with the signal's reason once it aborts. */
export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason as Error);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason as Error);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/** Who is retrying: the provider's name for messages, its policy and logger. */
export interface RetryContext {
  /** The provider's name in errors and logs (`OpenRouter`, `Anthropic`). */
  label: string;
  policy: RetryPolicy;
  logger: Pick<Logger, 'warn'>;
}

/**
 * The app-owned retry loop. Each try gets a signal that aborts at the
 * per-try timeout, `min(policy.timeoutMs, options.timeoutMs, time left
 * before options.deadlineAt)`, or when the caller's signal does. A retryable
 * failure (`toLLMError`) sleeps `Retry-After` when the provider sent one,
 * else full jitter, and the loop stops when tries run out, when the sleeps
 * would pass the budget, or when the next try would start past the
 * deadline. Then the last error is thrown, still classified, so the job's
 * own retry decides. A caller's abort is never retried.
 *
 * `latencyMs` is the answering try's, not the whole loop's.
 */
export async function sendWithRetries<T>(
  context: RetryContext,
  sendOnce: (signal: AbortSignal) => Promise<T>,
  options?: Pick<CompletionOptions, 'signal' | 'deadlineAt' | 'timeoutMs'>,
): Promise<{ result: T; latencyMs: number }> {
  const { label, policy, logger } = context;
  const callerSignal = options?.signal;
  const deadlineAt = options?.deadlineAt;
  const capMs = Math.min(
    policy.timeoutMs,
    options?.timeoutMs ?? Number.POSITIVE_INFINITY,
  );
  let sleptMs = 0;

  for (let attempt = 1; ; attempt++) {
    const tryMs =
      deadlineAt === undefined
        ? capMs
        : Math.min(capMs, deadlineAt - Date.now());
    if (tryMs <= 0) {
      // Transient like the run deadline itself: the job's retry gets a fresh one.
      throw new LLMError('The call passed its deadline before it was sent', {
        retryable: true,
      });
    }

    // A timer rather than `AbortSignal.timeout`, so fake timers drive it in specs.
    const timeout = new AbortController();
    const timer = setTimeout(
      () =>
        timeout.abort(
          new DOMException(
            `${label} try timed out after ${tryMs}ms`,
            'TimeoutError',
          ),
        ),
      tryMs,
    );
    const signal = callerSignal
      ? AbortSignal.any([timeout.signal, callerSignal])
      : timeout.signal;

    let error: LLMError;
    const startedAt = Date.now();
    try {
      const result = await sendOnce(signal);
      return { result, latencyMs: Date.now() - startedAt };
    } catch (raw: unknown) {
      error = classify(label, raw, callerSignal, timeout.signal, tryMs);
    } finally {
      clearTimeout(timer);
    }

    if (!error.retryable || attempt >= policy.maxAttempts) throw error;
    const delayMs = error.retryAfterMs ?? jitterMs(policy, attempt - 1);
    if (sleptMs + delayMs > policy.budgetMs) throw error;
    if (deadlineAt !== undefined && Date.now() + delayMs >= deadlineAt) {
      throw error;
    }

    logger.warn(
      `${label} try ${attempt}/${policy.maxAttempts} failed (${error.statusCode ?? 'no status'}: ${error.message}); retrying in ${delayMs}ms`,
    );
    try {
      await sleep(delayMs, callerSignal);
    } catch (reason: unknown) {
      throw abortedByCaller(label, reason);
    }
    sleptMs += delayMs;
  }
}

/**
 * The caller's abort wins over everything, our own per-try timeout
 * included; a timeout that fired is retryable whatever the transport made of
 * it.
 */
const classify = (
  label: string,
  raw: unknown,
  callerSignal: AbortSignal | undefined,
  timeoutSignal: AbortSignal,
  tryMs: number,
): LLMError => {
  if (callerSignal?.aborted) return abortedByCaller(label, raw);
  if (timeoutSignal.aborted) {
    return new LLMError(`${label} try timed out after ${tryMs}ms`, {
      retryable: true,
      cause: raw,
    });
  }
  return toLLMError(raw);
};

const abortedByCaller = (label: string, cause: unknown): LLMError =>
  new LLMError(`The ${label} call was aborted by its caller`, {
    retryable: false,
    cause,
  });
