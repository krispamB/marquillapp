import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type Redis from 'ioredis';
import { Types } from 'mongoose';
import { RunStatus, WorkflowRun } from 'src/database/schemas';
import { RedisService } from 'src/redis/redis.service';
import { WorkflowRunService } from 'src/workflow/workflow-run.service';
import { buildWorkflow } from 'src/workflow/engine/workflow.builder';
import {
  RunEventType,
  isTerminalRunEvent,
  runEventStreamKey,
} from 'src/workflow/engine/run-event.types';

/** Under common 30–60 s proxy idle timeouts, so an idle stream stays open. */
const HEARTBEAT_MS = 15000;

/** A run emits well under the stream's MAXLEN, so one read drains a replay. */
const XREAD_BATCH = 100;

/** One Redis stream entry as ioredis returns it: `[id, [field, value, ...]]`. */
type StreamEntry = [string, string[]];

type XReadResult = [string, StreamEntry[]][] | null;

/**
 * ioredis' typed `xread` overloads do not cover the `BLOCK ... COUNT` argument
 * order we need, so we call through a permissive signature. The shape is stable;
 * only the argument-tuple typing is the mismatch.
 */
type XReadFn = (...args: (string | number)[]) => Promise<XReadResult>;

/**
 * The HTTP half of the progress contract: relays a run's Redis stream to a
 * browser `EventSource` over SSE. A single `XREAD BLOCK` loop unifies replay,
 * live tail, and heartbeat cadence with no subscribe-race.
 *
 * Auth and ownership are ordinary JSON HTTP errors resolved *before* the stream
 * opens; once it is open, everything — including `run.failed` — is an SSE event,
 * so a mid-run failure never looks like a transport error to the client.
 */
@Injectable()
export class RunEventStreamService {
  constructor(
    private readonly workflowRunService: WorkflowRunService,
    private readonly redis: RedisService,
  ) {}

  async relay(
    runId: string,
    userId: string,
    req: Request,
    res: Response,
  ): Promise<void> {
    // Owner-scope before opening the stream: auth/ownership failures must be
    // HTTP errors, not mid-stream events.
    const run = await this.workflowRunService.getRun(runId);
    if (!run) {
      throw new NotFoundException(`Run ${runId} not found`);
    }
    if (this.idString(run.user) !== userId) {
      throw new ForbiddenException('You do not own this run');
    }

    const key = runEventStreamKey(runId);
    const client = this.redis.getClient();
    const cursor = this.readLastEventId(req) ?? '0';
    const terminal = this.isRunTerminal(run);

    if (terminal) {
      await this.relayTerminal(res, client, key, cursor, run);
      return;
    }

    await this.relayLive(req, res, client, key, cursor);
  }

  /**
   * A finished run has three shapes. Client is up to date → **204**, which per
   * the SSE spec stops `EventSource` reconnecting so a stale tab cannot poll a
   * done run forever. Client is behind → replay the tail (including the terminal
   * event) and close; the next reconnect hits the 204. Stream already expired →
   * synthesize a snapshot from the durable run record and close.
   */
  private async relayTerminal(
    res: Response,
    client: Redis,
    key: string,
    cursor: string,
    run: WorkflowRun,
  ): Promise<void> {
    let batch: XReadResult = await this.readOnce(client, key, cursor);

    if (!batch) {
      const length = await client.xlen(key);
      if (length === 0) {
        this.openStream(res);
        this.writeSnapshot(res, run);
        res.end();
        return;
      }
      res.writeHead(204);
      res.end();
      return;
    }

    this.openStream(res);
    let next = cursor;
    while (batch) {
      next = this.writeEntries(res, batch);
      batch = await this.readOnce(client, key, next);
    }
    res.end();
  }

  /**
   * Live tail: a dedicated `duplicate()` connection blocks on `XREAD`, because a
   * blocking read monopolizes its socket. It is quit on `req` close so a client
   * that goes away frees the connection. A block timeout with no entries writes
   * a heartbeat comment; the terminal event ends the stream.
   */
  private async relayLive(
    req: Request,
    res: Response,
    client: Redis,
    key: string,
    cursor: string,
  ): Promise<void> {
    this.openStream(res);

    const sub = client.duplicate();
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      void sub.quit().catch(() => undefined);
    };
    req.on('close', cleanup);

    try {
      let next = cursor;
      while (!closed) {
        const batch = await (sub.xread as XReadFn)(
          'BLOCK',
          HEARTBEAT_MS,
          'COUNT',
          XREAD_BATCH,
          'STREAMS',
          key,
          next,
        );

        if (closed) break;

        if (!batch) {
          res.write(': hb\n\n');
          continue;
        }

        for (const [id, fields] of batch[0][1]) {
          this.writeEntry(res, id, fields);
          next = id;
          if (this.isTerminalEntry(fields)) {
            cleanup();
            res.end();
            return;
          }
        }
      }
    } finally {
      cleanup();
    }
  }

  private readOnce(
    client: Redis,
    key: string,
    cursor: string,
  ): Promise<XReadResult> {
    return (client.xread as XReadFn)(
      'COUNT',
      XREAD_BATCH,
      'STREAMS',
      key,
      cursor,
    );
  }

  private openStream(res: Response): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disabling nginx response buffering is the single most common fix for
      // "SSE works locally, not in prod".
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    // Pin the reconnect backoff and force headers past any buffering proxy so
    // the client's `onopen` fires promptly, before any replay.
    res.write('retry: 3000\n\n');
    res.write(': hb\n\n');
  }

  /** Writes every entry in a batch and returns the last entry id (the cursor). */
  private writeEntries(
    res: Response,
    batch: [string, StreamEntry[]][],
  ): string {
    let last = '';
    for (const [id, fields] of batch[0][1]) {
      this.writeEntry(res, id, fields);
      last = id;
    }
    return last;
  }

  /**
   * `id:` is the Redis entry id — replay is then a native `XREAD ... <lastId>`
   * with no seq→offset index. `seq` still travels inside `data` for gap
   * detection. The stored `data` field is already the JSON the wire needs, so it
   * is forwarded verbatim rather than re-serialized.
   */
  private writeEntry(res: Response, id: string, fields: string[]): void {
    const event = this.fieldValue(fields, 'event');
    const data = this.fieldValue(fields, 'data');
    if (event === undefined || data === undefined) return;
    res.write(`id: ${id}\nevent: ${event}\ndata: ${data}\n\n`);
  }

  /**
   * The Redis stream has expired but the durable run record has not: reconstruct
   * the honest step list from the run's stored input and emit a run.started plus
   * the matching terminal event, so a late reconnect still renders final state.
   */
  private writeSnapshot(res: Response, run: WorkflowRun): void {
    const { type, withResearch, kind } = run.input;
    const { steps } = buildWorkflow({ type, withResearch, kind });

    let seq = 0;
    const emit = (event: RunEventType, data: Record<string, unknown>): void => {
      res.write(
        `event: ${event}\ndata: ${JSON.stringify({
          seq: ++seq,
          ts: Date.now(),
          ...data,
        })}\n\n`,
      );
    };

    emit(RunEventType.RUN_STARTED, { kind, type, steps });

    if (run.status === RunStatus.COMPLETED) {
      emit(RunEventType.RUN_COMPLETED, {
        artifactId: this.idString(run.artifact),
        version: run.targetVersion,
      });
    } else {
      emit(RunEventType.RUN_FAILED, {
        failureReason: run.failureReason ?? 'Run failed',
      });
    }
  }

  private isRunTerminal(run: WorkflowRun): boolean {
    return (
      run.status === RunStatus.COMPLETED || run.status === RunStatus.FAILED
    );
  }

  private isTerminalEntry(fields: string[]): boolean {
    const event = this.fieldValue(fields, 'event');
    return event !== undefined && isTerminalRunEvent(event as RunEventType);
  }

  /** A run reference is an unpopulated `ObjectId`; stringify it as such. */
  private idString(ref: unknown): string {
    return (ref as Types.ObjectId).toString();
  }

  private fieldValue(fields: string[], name: string): string | undefined {
    for (let i = 0; i + 1 < fields.length; i += 2) {
      if (fields[i] === name) return fields[i + 1];
    }
    return undefined;
  }

  /** EventSource sends `Last-Event-ID`; Express lowercases the header name. */
  private readLastEventId(req: Request): string | undefined {
    const raw = req.headers['last-event-id'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value && value.length > 0 ? value : undefined;
  }
}
