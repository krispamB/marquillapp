import { RunEventEmitter } from './run-event.emitter';
import {
  RUN_EVENT_STREAM_MAXLEN,
  RUN_EVENT_STREAM_TTL_SECONDS,
  RunEventType,
} from './run-event.types';

describe('RunEventEmitter', () => {
  const runId = '665f1b2c3d4e5f6a7b8c9d0e';

  const makeEmitter = () => {
    const redis = {
      xadd: jest.fn().mockResolvedValue('1-0'),
      expire: jest.fn().mockResolvedValue(1),
    };
    const logger = { error: jest.fn(), warn: jest.fn() };

    const emitter = new RunEventEmitter(redis as any, runId, logger as any);

    return { emitter, mocks: { redis, logger } };
  };

  let emitter: RunEventEmitter;
  let mocks: ReturnType<typeof makeEmitter>['mocks'];

  beforeEach(() => {
    jest.clearAllMocks();
    ({ emitter, mocks } = makeEmitter());
  });

  /** The JSON payload the emitter wrote on the nth xadd call. */
  const writtenData = (call: number): Record<string, unknown> => {
    const args = mocks.redis.xadd.mock.calls[call] as string[];
    return JSON.parse(args[args.length - 1]) as Record<string, unknown>;
  };

  const writtenType = (call: number): string => {
    const args = mocks.redis.xadd.mock.calls[call] as string[];
    return args[args.length - 3];
  };

  describe('seq', () => {
    it('should start the per-run sequence at 1', async () => {
      emitter.emit({ type: RunEventType.RUN_STARTED, data: {} });
      await emitter.flush();

      expect(writtenData(0).seq).toBe(1);
    });

    it('should assign a monotonically increasing seq across events', async () => {
      emitter.emit({ type: RunEventType.RUN_STARTED, data: {} });
      emitter.emit({ type: RunEventType.STEP_STARTED, data: {} });
      emitter.emit({ type: RunEventType.STEP_COMPLETED, data: {} });
      await emitter.flush();

      expect([
        writtenData(0).seq,
        writtenData(1).seq,
        writtenData(2).seq,
      ]).toEqual([1, 2, 3]);
    });

    it('should assign seq synchronously at emit time, so ordering survives async writes', async () => {
      // The first write hangs; the second must still be seq 2 and must not
      // overtake it on the wire.
      let releaseFirst!: () => void;
      mocks.redis.xadd
        .mockImplementationOnce(
          () => new Promise<string>((res) => (releaseFirst = () => res('1-0'))),
        )
        .mockResolvedValue('2-0');

      emitter.emit({ type: RunEventType.STEP_STARTED, data: { step: 'a' } });
      emitter.emit({ type: RunEventType.STEP_COMPLETED, data: { step: 'a' } });

      // Let the queued write start, then confirm the second is still held back
      // behind the first rather than racing it onto the wire.
      await Promise.resolve();
      expect(mocks.redis.xadd).toHaveBeenCalledTimes(1);

      releaseFirst();
      await emitter.flush();

      expect(mocks.redis.xadd).toHaveBeenCalledTimes(2);
      expect(writtenType(0)).toBe(RunEventType.STEP_STARTED);
      expect(writtenType(1)).toBe(RunEventType.STEP_COMPLETED);
      expect(writtenData(1).seq).toBe(2);
    });
  });

  describe('stream write', () => {
    it('should XADD to the run stream key with a bounded MAXLEN', async () => {
      emitter.emit({
        type: RunEventType.STEP_STARTED,
        data: { step: 'GENERATE' },
      });
      await emitter.flush();

      expect(mocks.redis.xadd).toHaveBeenCalledWith(
        `workflow:run:${runId}`,
        'MAXLEN',
        '~',
        RUN_EVENT_STREAM_MAXLEN,
        '*',
        'event',
        RunEventType.STEP_STARTED,
        'data',
        expect.any(String),
      );
    });

    it('should carry seq, ts, and the step payload inside data', async () => {
      emitter.emit({
        type: RunEventType.STEP_COMPLETED,
        data: { step: 'GENERATE', index: 1, total: 3 },
      });
      await emitter.flush();

      expect(writtenData(0)).toEqual({
        seq: 1,
        ts: expect.any(Number),
        step: 'GENERATE',
        index: 1,
        total: 3,
      });
    });

    it('should never PUBLISH — XADD is the only side effect', async () => {
      emitter.emit({ type: RunEventType.RUN_STARTED, data: {} });
      await emitter.flush();

      expect(mocks.redis).not.toHaveProperty('publish');
      expect(Object.keys(mocks.redis)).toEqual(['xadd', 'expire']);
    });
  });

  describe('retention', () => {
    it('should EXPIRE the stream on run.completed', async () => {
      emitter.emit({ type: RunEventType.RUN_COMPLETED, data: {} });
      await emitter.flush();

      expect(mocks.redis.expire).toHaveBeenCalledWith(
        `workflow:run:${runId}`,
        RUN_EVENT_STREAM_TTL_SECONDS,
      );
    });

    it('should EXPIRE the stream on run.failed', async () => {
      emitter.emit({ type: RunEventType.RUN_FAILED, data: {} });
      await emitter.flush();

      expect(mocks.redis.expire).toHaveBeenCalledWith(
        `workflow:run:${runId}`,
        RUN_EVENT_STREAM_TTL_SECONDS,
      );
    });

    it('should not EXPIRE the stream on a non-terminal event', async () => {
      emitter.emit({ type: RunEventType.STEP_COMPLETED, data: {} });
      emitter.emit({ type: RunEventType.USAGE_TICK, data: {} });
      await emitter.flush();

      expect(mocks.redis.expire).not.toHaveBeenCalled();
    });

    it('should set the TTL only after the terminal event is written', async () => {
      const order: string[] = [];
      mocks.redis.xadd.mockImplementation(() => {
        order.push('xadd');
        return Promise.resolve('1-0');
      });
      mocks.redis.expire.mockImplementation(() => {
        order.push('expire');
        return Promise.resolve(1);
      });

      emitter.emit({ type: RunEventType.RUN_COMPLETED, data: {} });
      await emitter.flush();

      expect(order).toEqual(['xadd', 'expire']);
    });
  });

  describe('failure isolation', () => {
    it('should swallow a Redis write failure rather than fail the run', async () => {
      mocks.redis.xadd.mockRejectedValue(new Error('redis down'));

      emitter.emit({ type: RunEventType.STEP_STARTED, data: {} });

      await expect(emitter.flush()).resolves.toBeUndefined();
      expect(mocks.logger.error).toHaveBeenCalled();
    });

    it('should keep emitting after a failed write', async () => {
      mocks.redis.xadd
        .mockRejectedValueOnce(new Error('redis blip'))
        .mockResolvedValue('2-0');

      emitter.emit({ type: RunEventType.STEP_STARTED, data: {} });
      emitter.emit({ type: RunEventType.STEP_COMPLETED, data: {} });
      await emitter.flush();

      expect(mocks.redis.xadd).toHaveBeenCalledTimes(2);
      expect(writtenData(1).seq).toBe(2);
    });

    it('should swallow an EXPIRE failure on the terminal event', async () => {
      mocks.redis.expire.mockRejectedValue(new Error('redis down'));

      emitter.emit({ type: RunEventType.RUN_COMPLETED, data: {} });

      await expect(emitter.flush()).resolves.toBeUndefined();
      expect(mocks.logger.error).toHaveBeenCalled();
    });

    it('should not throw synchronously out of emit', () => {
      mocks.redis.xadd.mockRejectedValue(new Error('redis down'));

      expect(() =>
        emitter.emit({ type: RunEventType.RUN_STARTED, data: {} }),
      ).not.toThrow();
    });
  });

  describe('flush', () => {
    it('should resolve once every queued write has landed', async () => {
      emitter.emit({ type: RunEventType.RUN_STARTED, data: {} });
      emitter.emit({ type: RunEventType.STEP_STARTED, data: {} });
      emitter.emit({ type: RunEventType.RUN_COMPLETED, data: {} });

      await emitter.flush();

      expect(mocks.redis.xadd).toHaveBeenCalledTimes(3);
      expect(mocks.redis.expire).toHaveBeenCalledTimes(1);
    });
  });
});
