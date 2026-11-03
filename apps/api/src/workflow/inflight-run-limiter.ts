import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readIntEnv } from '../common/env';
import { RedisService } from '../redis/redis.service';
import { RunTooManyInFlightException } from './run-too-many-in-flight.exception';

export const INFLIGHT_KEY_PREFIX = 'workflow:inflight:';
const DEFAULT_LEASE_SECONDS = 1800;

/**
 * Reaps entries whose lease has expired, then admits the run unless the user
 * already holds `limit`. Time is Redis's own (`TIME`), so API and worker hosts
 * need no synchronised clocks. KEYS[1] = the user's set; ARGV = limit, lease
 * ms, run id. Returns 1 when reserved, 0 when over the cap.
 */
export const RESERVE_SCRIPT = `
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[1]) then
  return 0
end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[3])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
return 1
`;

/**
 * Pushes a held run's lease out; a run that is not in the set (released, or
 * reaped after its lease ran out) is not re-added. KEYS[1] = the user's set;
 * ARGV = lease ms, run id.
 */
export const REFRESH_SCRIPT = `
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
redis.call('ZADD', KEYS[1], 'XX', now + tonumber(ARGV[1]), ARGV[2])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]))
return 1
`;

/**
 * Caps how many artifact runs one user has in flight, so a single batch can't
 * fill the queue for everyone. A run holds a slot from the launch check until
 * it ends; the slot is a lease, so a run whose release was lost frees itself
 * after `RUN_INFLIGHT_LEASE_SECONDS`.
 *
 * `MAX_INFLIGHT_RUNS_PER_USER=0` (the default) turns it off: no Redis calls.
 * A Redis error never blocks or fails a run: `reserve` fails open, and
 * `refresh` and `release` log and carry on.
 */
@Injectable()
export class InflightRunLimiter {
  private readonly logger = new Logger(InflightRunLimiter.name);
  private readonly limit: number;
  private readonly leaseMs: number;

  constructor(
    config: ConfigService,
    private readonly redis: RedisService,
  ) {
    this.limit = readIntEnv(config, 'MAX_INFLIGHT_RUNS_PER_USER', {
      default: 0,
    });
    this.leaseMs =
      readIntEnv(config, 'RUN_INFLIGHT_LEASE_SECONDS', {
        default: DEFAULT_LEASE_SECONDS,
        min: 1,
      }) * 1000;
  }

  /** Takes a slot for `runId`, or throws `RunTooManyInFlightException`. */
  async reserve(userId: string, runId: string): Promise<void> {
    if (this.limit === 0) return;
    let reserved: unknown;
    try {
      reserved = await this.redis
        .getClient()
        .eval(
          RESERVE_SCRIPT,
          1,
          this.keyFor(userId),
          this.limit,
          this.leaseMs,
          runId,
        );
    } catch (error: unknown) {
      this.logger.warn(
        `Could not reserve an in-flight slot for run ${runId}; allowing it: ${errorText(error)}`,
      );
      return;
    }
    if (Number(reserved) !== 1)
      throw new RunTooManyInFlightException(this.limit);
  }

  /** Gives the slot back. Idempotent; never throws. */
  async release(userId: string, runId: string): Promise<void> {
    if (this.limit === 0) return;
    try {
      await this.redis.getClient().zrem(this.keyFor(userId), runId);
    } catch (error: unknown) {
      this.logger.warn(
        `Could not release the in-flight slot of run ${runId}: ${errorText(error)}`,
      );
    }
  }

  /** Extends the lease of a run that is starting a job attempt. Never throws. */
  async refresh(userId: string, runId: string): Promise<void> {
    if (this.limit === 0) return;
    try {
      await this.redis
        .getClient()
        .eval(REFRESH_SCRIPT, 1, this.keyFor(userId), this.leaseMs, runId);
    } catch (error: unknown) {
      this.logger.warn(
        `Could not refresh the in-flight lease of run ${runId}: ${errorText(error)}`,
      );
    }
  }

  private keyFor(userId: string): string {
    return `${INFLIGHT_KEY_PREFIX}${userId}`;
  }
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
