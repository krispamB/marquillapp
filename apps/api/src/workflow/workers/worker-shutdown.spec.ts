import { EventEmitter } from 'node:events';
import {
  installWorkerShutdown,
  readWorkerShutdownTimeoutMs,
  type WorkerShutdownDeps,
} from './worker-shutdown';

/** A promise whose settling the test controls. */
const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const makeDeps = (overrides: Partial<WorkerShutdownDeps> = {}) => {
  const signals = new EventEmitter();
  const order: string[] = [];
  const closable = (name: string) => ({
    close: jest.fn(() => {
      order.push(`close ${name}`);
      return Promise.resolve();
    }),
  });
  const deps = {
    signals,
    closables: [closable('workflow'), closable('email')],
    listeners: [closable('events')],
    idle: jest.fn(() => {
      order.push('idle');
      return Promise.resolve();
    }),
    app: closable('app'),
    exit: jest.fn((code: number) => {
      order.push(`exit ${code}`);
    }),
    timeoutMs: 120_000,
    // Read at call time, so they are jest's fakes.
    timers: {
      setTimeout: (callback: () => void, ms: number) =>
        setTimeout(callback, ms),
      clearTimeout: (handle: unknown) => clearTimeout(handle as NodeJS.Timeout),
    },
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    ...overrides,
  } satisfies WorkerShutdownDeps;
  return { deps, signals, order };
};

/** Lets every queued microtask, and the ones they queue, run. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('installWorkerShutdown', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each(['SIGTERM', 'SIGINT'])(
    'should close the workers, wait for failure handlers, close the app, then exit 0 when %s arrives',
    async (signal) => {
      const { deps, signals, order } = makeDeps();
      installWorkerShutdown(deps);

      signals.emit(signal);
      await settle();

      expect(order).toEqual([
        'close workflow',
        'close email',
        'close events',
        'idle',
        'close app',
        'exit 0',
      ]);
    },
  );

  it('should not exit when an in-flight job is still running', async () => {
    const job = deferred();
    const { deps, signals } = makeDeps({
      closables: [{ close: () => job.promise }],
    });
    installWorkerShutdown(deps);

    signals.emit('SIGTERM');
    await settle();
    expect(deps.app.close).not.toHaveBeenCalled();
    expect(deps.exit).not.toHaveBeenCalled();

    job.resolve();
    await settle();
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it('should keep the event listeners open when a worker is still draining', async () => {
    const job = deferred();
    const listener = { close: jest.fn(() => Promise.resolve()) };
    const { deps, signals } = makeDeps({
      closables: [{ close: () => job.promise }],
      listeners: [listener],
    });
    installWorkerShutdown(deps);

    signals.emit('SIGTERM');
    await settle();
    expect(listener.close).not.toHaveBeenCalled();

    job.resolve();
    await settle();
    expect(listener.close).toHaveBeenCalled();
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it('should close the app only after the failure handlers settle when some are in flight', async () => {
    const handlers = deferred();
    const { deps, signals } = makeDeps({ idle: () => handlers.promise });
    installWorkerShutdown(deps);

    signals.emit('SIGTERM');
    await settle();
    expect(deps.app.close).not.toHaveBeenCalled();

    handlers.resolve();
    await settle();
    expect(deps.app.close).toHaveBeenCalled();
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it('should still close the other workers and exit 0 when one fails to close', async () => {
    const { deps, signals } = makeDeps({
      closables: [
        { close: jest.fn().mockRejectedValue(new Error('redis gone')) },
        { close: jest.fn().mockResolvedValue(undefined) },
      ],
    });
    installWorkerShutdown(deps);

    signals.emit('SIGTERM');
    await settle();

    expect(deps.closables[1].close).toHaveBeenCalled();
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('redis gone'),
    );
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it('should exit 1 when the app fails to close', async () => {
    const { deps, signals } = makeDeps({
      app: { close: jest.fn().mockRejectedValue(new Error('mongo gone')) },
    });
    installWorkerShutdown(deps);

    signals.emit('SIGTERM');
    await settle();

    expect(deps.exit).toHaveBeenCalledWith(1);
  });

  it('should force exit 1 when the drain outlasts the timeout', async () => {
    const job = deferred();
    const { deps, signals } = makeDeps({
      closables: [{ close: () => job.promise }],
      timeoutMs: 5_000,
    });
    installWorkerShutdown(deps);

    signals.emit('SIGTERM');
    await settle();
    jest.advanceTimersByTime(4_999);
    expect(deps.exit).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(deps.exit).toHaveBeenCalledWith(1);
    expect(deps.exit).toHaveBeenCalledTimes(1);
  });

  it('should not force exit when the drain finished in time', async () => {
    const { deps, signals } = makeDeps({ timeoutMs: 5_000 });
    installWorkerShutdown(deps);

    signals.emit('SIGTERM');
    await settle();
    jest.advanceTimersByTime(10_000);

    expect(deps.exit).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it('should not start a second shutdown when a second signal arrives', async () => {
    const job = deferred();
    const close = jest.fn(() => job.promise);
    const { deps, signals } = makeDeps({ closables: [{ close }] });
    installWorkerShutdown(deps);

    signals.emit('SIGTERM');
    signals.emit('SIGINT');
    signals.emit('SIGTERM');
    job.resolve();
    await settle();

    expect(close).toHaveBeenCalledTimes(1);
    expect(deps.app.close).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledTimes(1);
  });

  it('should keep its listeners when the first signal arrives, so a second one cannot kill the process', () => {
    const { deps, signals } = makeDeps();
    installWorkerShutdown(deps);

    signals.emit('SIGTERM');

    expect(signals.listenerCount('SIGTERM')).toBe(1);
    expect(signals.listenerCount('SIGINT')).toBe(1);
  });
});

describe('readWorkerShutdownTimeoutMs', () => {
  it('should default to 120000 when unset', () => {
    expect(readWorkerShutdownTimeoutMs({})).toBe(120_000);
  });

  it('should read the value when it is set', () => {
    expect(
      readWorkerShutdownTimeoutMs({ WORKER_SHUTDOWN_TIMEOUT_MS: '30000' }),
    ).toBe(30_000);
  });

  it('should throw naming the key when the value is not an integer', () => {
    expect(() =>
      readWorkerShutdownTimeoutMs({ WORKER_SHUTDOWN_TIMEOUT_MS: '2m' }),
    ).toThrow('WORKER_SHUTDOWN_TIMEOUT_MS');
  });
});
