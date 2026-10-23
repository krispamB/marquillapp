import { randomUUID } from 'node:crypto';
import { setTimeout as sleepFor } from 'node:timers/promises';
import type { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { readIntEnv, type EnvSource } from '../common/env';
import { RENDER_SLOT_LEASE_MS } from './document-render.constants';

/** The sorted set of slot leases: lease token, scored by its expiry (ms). */
export const RENDER_SLOTS_KEY = 'browserless:slots';

/** The shortest and longest pause between two polls for a free slot. */
const POLL_MIN_MS = 250;
const POLL_MAX_MS = 1_000;

/**
 * Takes a slot atomically, on Redis's clock so workers never disagree about
 * which leases have expired: drop expired leases, then add this one if fewer
 * than the limit are held. The key's expiry is pushed out to cover the newest
 * lease (never pulled in), so an idle set does not linger. Returns 1 when the slot was taken, 0 when all are held.
 *
 * KEYS[1] the set; ARGV[1] the limit, ARGV[2] the lease in ms, ARGV[3] the token.
 */
const ACQUIRE_SCRIPT = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) < tonumber(ARGV[1]) then
  redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[3])
  if redis.call('PTTL', KEYS[1]) < tonumber(ARGV[2]) then
    redis.call('PEXPIRE', KEYS[1], ARGV[2])
  end
  return 1
end
return 0
`;

/** All the semaphore needs from ioredis. */
export type RenderSlotsRedis = Pick<Redis, 'eval' | 'zrem'>;

/** A held slot (or none, when the semaphore is off or failed open). */
export interface RenderSlotLease {
  /** How long the render waited for the slot. */
  waitedMs: number;
  /** Frees the slot. Safe to call twice; never throws. */
  release(): Promise<void>;
}

/**
 * No Browserless slot came free in time. A transient `render.unavailable`:
 * no session ran, so nothing is recorded and nothing is billed.
 */
export class RenderSlotUnavailableError extends Error {
  constructor(
    readonly limit: number,
    readonly waitedMs: number,
  ) {
    super(
      `No Browserless slot came free in ${waitedMs}ms (${limit} concurrent sessions)`,
    );
    this.name = 'RenderSlotUnavailableError';
  }
}

export interface RenderSlotsSettings {
  /** `BROWSERLESS_MAX_CONCURRENT_SESSIONS`: the plan's limit; 0 turns the semaphore off. */
  limit: number;
  /** `BROWSERLESS_SLOT_WAIT_MAX_MS`: the longest a render waits for a slot. */
  maxWaitMs: number;
  /** How long a lease lives without a release. */
  leaseMs: number;
}

export const DEFAULT_SLOT_WAIT_MAX_MS = 120_000;

/** Reads the semaphore's settings; a bad value throws, naming the key. */
export function renderSlotsSettings(source: EnvSource): RenderSlotsSettings {
  return {
    limit: readIntEnv(source, 'BROWSERLESS_MAX_CONCURRENT_SESSIONS', {
      default: 0,
    }),
    maxWaitMs: readIntEnv(source, 'BROWSERLESS_SLOT_WAIT_MAX_MS', {
      default: DEFAULT_SLOT_WAIT_MAX_MS,
    }),
    leaseMs: RENDER_SLOT_LEASE_MS,
  };
}

/**
 * The pause before poll `attempt + 1`, jittered: 250-500 ms after the first
 * try, 500 ms-1 s after every later one.
 */
export function slotPollDelayMs(attempt: number, random: () => number): number {
  const ceiling = Math.min(POLL_MAX_MS, POLL_MIN_MS * 2 ** (attempt + 1));
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
}

export interface RenderSlotsOptions extends RenderSlotsSettings {
  redis: RenderSlotsRedis;
  logger: Pick<Logger, 'warn'>;
  key?: string;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<unknown>;
  now?: () => number;
  random?: () => number;
  token?: () => string;
}

const NO_SLOT: Omit<RenderSlotLease, 'waitedMs'> = {
  release: () => Promise.resolve(),
};

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * A cross-worker semaphore over Browserless sessions (M4.2), so a render
 * waits for a free slot instead of failing when the plan's concurrent-browser
 * limit is reached.
 *
 * Off (no Redis calls) when the limit is 0. Redis errors fail open: the render
 * goes ahead without a slot, because a Redis outage must not stop documents.
 */
export class RenderSlots {
  private readonly key: string;
  private readonly sleep: (ms: number) => Promise<unknown>;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly token: () => string;

  constructor(private readonly options: RenderSlotsOptions) {
    this.key = options.key ?? RENDER_SLOTS_KEY;
    this.sleep = options.sleep ?? ((ms) => sleepFor(ms));
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.token = options.token ?? randomUUID;
  }

  /**
   * Takes a slot, polling until one is free for at most
   * `min(budgetMs, BROWSERLESS_SLOT_WAIT_MAX_MS)`, then throws
   * `RenderSlotUnavailableError`. A budget of 0 is a single try.
   */
  async acquire(budgetMs: number): Promise<RenderSlotLease> {
    const { limit, maxWaitMs, leaseMs, redis, logger } = this.options;
    if (limit <= 0) return { waitedMs: 0, ...NO_SLOT };

    const waitMs = Math.max(0, Math.min(budgetMs, maxWaitMs));
    const token = this.token();
    const started = this.now();
    for (let attempt = 0; ; attempt += 1) {
      let taken: boolean;
      try {
        taken =
          (await redis.eval(
            ACQUIRE_SCRIPT,
            1,
            this.key,
            String(limit),
            String(leaseMs),
            token,
          )) === 1;
      } catch (error: unknown) {
        logger.warn(
          `Browserless slot acquire failed; rendering without a slot: ${reasonOf(error)}`,
        );
        return { waitedMs: this.now() - started, ...NO_SLOT };
      }

      const waitedMs = this.now() - started;
      if (taken) return { waitedMs, release: this.releaser(token) };

      const leftMs = waitMs - waitedMs;
      if (leftMs <= 0) throw new RenderSlotUnavailableError(limit, waitedMs);
      await this.sleep(Math.min(leftMs, slotPollDelayMs(attempt, this.random)));
    }
  }

  private releaser(token: string): () => Promise<void> {
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      try {
        await this.options.redis.zrem(this.key, token);
      } catch (error: unknown) {
        // The lease expires on its own; the slot is only held a little longer.
        this.options.logger.warn(
          `Browserless slot release failed; the lease will expire: ${reasonOf(error)}`,
        );
      }
    };
  }
}
