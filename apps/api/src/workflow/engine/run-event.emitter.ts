import type { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import {
  EmittedEvent,
  RUN_EVENT_STREAM_MAXLEN,
  RUN_EVENT_STREAM_TTL_SECONDS,
  RunEvent,
  isTerminalRunEvent,
  runEventStreamKey,
} from './run-event.types';
import { describeError } from './workflow.error';

/** All the emitter needs from ioredis — and all it is ever allowed to do. */
export type RunEventRedis = Pick<Redis, 'xadd' | 'expire'>;

/**
 * The engine's one emission side effect: `XADD workflow:run:{runId}`. No
 * `PUBLISH` — the HTTP relay's `XREAD BLOCK` unifies replay, live tail, and
 * heartbeat cadence in a single mechanism with no subscribe-race.
 *
 * `emit` is fire-and-forget so steps and the meter can announce synchronously.
 * Two properties make that safe:
 *
 * - `seq` is stamped **synchronously** at call time, so it reflects emit order
 *   rather than whichever write happens to land first.
 * - writes are serialized onto one promise chain, so Redis receives them in
 *   that same order and the stream's own entry IDs stay consistent with `seq`.
 *
 * A failed write is logged and dropped. Progress telemetry must never take a
 * run down with it.
 */
export class RunEventEmitter {
  private seq = 0;
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly redis: RunEventRedis,
    private readonly runId: string,
    private readonly logger: Logger,
  ) {}

  emit(event: EmittedEvent): void {
    const envelope: RunEvent = {
      runId: this.runId,
      seq: ++this.seq,
      ts: Date.now(),
      type: event.type,
      data: event.data,
    };

    this.tail = this.tail.then(() =>
      this.write(envelope).catch((error: unknown) => {
        this.logger.error(
          `Failed to write run event ${envelope.type} (seq ${envelope.seq}) for run ${this.runId}: ${describeError(error)}`,
        );
      }),
    );
  }

  /** Resolves once every event emitted so far has been written (or dropped). */
  flush(): Promise<void> {
    return this.tail;
  }

  private async write(event: RunEvent): Promise<void> {
    const key = runEventStreamKey(this.runId);

    // `seq` and `ts` travel inside `data` because the SSE wire format hands the
    // client the Redis entry ID as `id:` — `seq` is the app-level counter it
    // uses to detect gaps independently of that opaque transport id.
    const payload = JSON.stringify({
      seq: event.seq,
      ts: event.ts,
      ...event.data,
    });

    await this.redis.xadd(
      key,
      'MAXLEN',
      '~',
      RUN_EVENT_STREAM_MAXLEN,
      '*',
      'event',
      event.type,
      'data',
      payload,
    );

    // Reclaim the log an hour after the run ends — long enough for a client
    // reconnecting shortly after completion to replay it in full.
    if (isTerminalRunEvent(event.type)) {
      await this.redis.expire(key, RUN_EVENT_STREAM_TTL_SECONDS);
    }
  }
}
