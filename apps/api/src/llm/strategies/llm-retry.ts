import { readIntEnv, type EnvSource } from '../../common/env';

/**
 * How `OpenRouterStrategy` retries one call. The SDK's own retries are off:
 * they share one timeout across every try and skip 429s, so this loop owns
 * both.
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

/** Reads the `OPENROUTER_*` retry keys. A bad value throws, naming the key. */
export const readRetryPolicy = (source: EnvSource): RetryPolicy => ({
  timeoutMs: readIntEnv(source, 'OPENROUTER_TIMEOUT_MS', {
    default: 240_000,
    min: 1,
  }),
  maxAttempts: readIntEnv(source, 'OPENROUTER_MAX_ATTEMPTS', {
    default: 3,
    min: 1,
  }),
  baseMs: readIntEnv(source, 'OPENROUTER_RETRY_BASE_MS', { default: 1_000 }),
  maxDelayMs: readIntEnv(source, 'OPENROUTER_RETRY_MAX_DELAY_MS', {
    default: 15_000,
  }),
  budgetMs: readIntEnv(source, 'OPENROUTER_RETRY_BUDGET_MS', {
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
