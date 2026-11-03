import type { Logger } from '@nestjs/common';
import { readIntEnv, type EnvSource } from '../../common/env';
import { describeError } from '../engine/workflow.error';

/** A BullMQ `Worker` or `QueueEvents`, or the Nest application context. */
export interface Closable {
  close(): Promise<unknown>;
}

/** The slice of `process` the shutdown listens on. */
export interface SignalSource {
  on(signal: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
}

/** `setTimeout` and `clearTimeout`, injectable so a spec can fake them. */
export interface ShutdownTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface WorkerShutdownDeps {
  signals: SignalSource;
  /** Closed first, together: a `Worker` resolves once its active jobs finish. */
  closables: Closable[];
  /**
   * Closed once the workers have drained, so a failure reported while jobs
   * finish (a `QueueEvents` stalled-job report) is still handled.
   */
  listeners: Closable[];
  /** Resolves once the failure handlers those jobs started have settled. */
  idle: () => Promise<void>;
  /** Closed last, since the jobs and their handlers need Redis and Mongo. */
  app: Closable;
  exit: (code: number) => void;
  timeoutMs: number;
  timers: ShutdownTimers;
  logger: Pick<Logger, 'log' | 'warn' | 'error'>;
}

export const DEFAULT_WORKER_SHUTDOWN_TIMEOUT_MS = 120_000;

/** `WORKER_SHUTDOWN_TIMEOUT_MS`; a bad value fails the boot. */
export const readWorkerShutdownTimeoutMs = (source: EnvSource): number =>
  readIntEnv(source, 'WORKER_SHUTDOWN_TIMEOUT_MS', {
    default: DEFAULT_WORKER_SHUTDOWN_TIMEOUT_MS,
  });

const closeAll = async (
  closables: Closable[],
  logger: WorkerShutdownDeps['logger'],
): Promise<void> => {
  const closed = await Promise.allSettled(
    closables.map((closable) => closable.close()),
  );
  for (const result of closed) {
    if (result.status === 'rejected') {
      logger.error(`A worker failed to close: ${describeError(result.reason)}`);
    }
  }
};

/**
 * Drains the worker on the first `SIGTERM` or `SIGINT`: close every worker,
 * letting its active jobs finish; close the event listeners; wait for the failure handlers they started;
 * close the app; exit 0. If that outlasts `timeoutMs`, exit 1: the job that
 * was still running stalls, and the next worker picks it up from its
 * checkpoint.
 *
 * Nest's `enableShutdownHooks` is not used because its `onModuleDestroy`
 * closes Redis and Mongo while jobs still need them. The listeners stay
 * attached after the first signal, so a second one is ignored rather than
 * falling through to Node's default handler, which would kill the process.
 */
export function installWorkerShutdown(deps: WorkerShutdownDeps): void {
  const { logger, timers } = deps;
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      logger.warn(`${signal} received; already shutting down`);
      return;
    }
    shuttingDown = true;
    logger.log(
      `${signal} received; draining jobs (up to ${deps.timeoutMs} ms)`,
    );

    const timer = timers.setTimeout(() => {
      logger.error(
        `Shutdown did not finish within ${deps.timeoutMs} ms; forcing exit`,
      );
      deps.exit(1);
    }, deps.timeoutMs);

    await closeAll(deps.closables, logger);
    await closeAll(deps.listeners, logger);
    await deps.idle();

    try {
      await deps.app.close();
    } catch (error: unknown) {
      timers.clearTimeout(timer);
      logger.error(`The app failed to close: ${describeError(error)}`);
      deps.exit(1);
      return;
    }
    timers.clearTimeout(timer);
    logger.log('Worker drained; exiting');
    deps.exit(0);
  };

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    deps.signals.on(signal, () => void shutdown(signal));
  }
}
