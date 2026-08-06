jest.mock(
  'src/database/schemas',
  () => ({
    RunStatus: { RUNNING: 'RUNNING', COMPLETED: 'COMPLETED', FAILED: 'FAILED' },
    WorkflowRun: class WorkflowRun {},
  }),
  { virtual: true },
);
jest.mock('src/redis/redis.service', () => ({ RedisService: class {} }), {
  virtual: true,
});
jest.mock(
  'src/workflow/workflow-run.service',
  () => ({ WorkflowRunService: class {} }),
  { virtual: true },
);
jest.mock(
  'src/workflow/engine/workflow.builder',
  () => ({
    buildWorkflow: () => ({
      name: 'artifact:POST',
      steps: ['RESOLVE_INPUT', 'GENERATE', 'PERSIST_VERSION'],
    }),
  }),
  { virtual: true },
);
jest.mock(
  'src/workflow/engine/run-event.types',
  () => {
    const RunEventType = {
      RUN_STARTED: 'run.started',
      RUN_COMPLETED: 'run.completed',
      RUN_FAILED: 'run.failed',
      STEP_STARTED: 'step.started',
    };
    const terminal = new Set(['run.completed', 'run.failed']);
    return {
      RunEventType,
      isTerminalRunEvent: (t: string) => terminal.has(t),
      runEventStreamKey: (id: string) => `workflow:run:${id}`,
    };
  },
  { virtual: true },
);

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { RunEventStreamService } from './run-event-stream.service';

type Entry = [string, string[]];

const entry = (id: string, event: string, data: object): Entry => [
  id,
  ['event', event, 'data', JSON.stringify(data)],
];
const batch = (key: string, entries: Entry[]) => [[key, entries]];

const makeRes = () => ({
  writeHead: jest.fn().mockReturnThis(),
  write: jest.fn().mockReturnValue(true),
  end: jest.fn(),
  flushHeaders: jest.fn(),
});

const makeReq = (headers: Record<string, string> = {}) => {
  const handlers: Record<string, () => void> = {};
  return {
    headers,
    on: jest.fn((event: string, cb: () => void) => {
      handlers[event] = cb;
    }),
    close: () => handlers.close?.(),
  };
};

describe('RunEventStreamService', () => {
  const userId = 'user123';
  const runId = 'run123';
  const key = `workflow:run:${runId}`;

  const runningRun = {
    user: userId,
    status: 'RUNNING',
    artifact: 'artifact123',
    targetVersion: 1,
    input: { type: 'POST', withResearch: false, kind: 'INITIAL' },
  };

  const makeService = (
    run: unknown,
    redisClient: Record<string, jest.Mock>,
  ) => {
    const workflowRunService = {
      getRun: jest.fn().mockResolvedValue(run),
    };
    const redis = { getClient: () => redisClient };
    const service = new RunEventStreamService(
      workflowRunService as any,
      redis as any,
    );
    return { service, workflowRunService };
  };

  const allWrites = (res: ReturnType<typeof makeRes>) =>
    res.write.mock.calls.map((c) => c[0]).join('');

  describe('pre-stream ownership checks', () => {
    it('should throw NotFoundException for an unknown run without writing', async () => {
      const { service } = makeService(null, {});
      const res = makeRes();

      await expect(
        service.relay(runId, userId, makeReq() as any, res as any),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(res.writeHead).not.toHaveBeenCalled();
      expect(res.write).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when the caller does not own the run', async () => {
      const { service } = makeService(
        { ...runningRun, user: 'someone-else' },
        {},
      );
      const res = makeRes();

      await expect(
        service.relay(runId, userId, makeReq() as any, res as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(res.writeHead).not.toHaveBeenCalled();
    });
  });

  describe('live tail (RUNNING run)', () => {
    it('should open with anti-buffering headers and an initial retry+heartbeat frame', async () => {
      const sub = {
        xread: jest
          .fn()
          .mockResolvedValue(
            batch(key, [entry('1-0', 'run.completed', { seq: 1, ts: 1 })]),
          ),
        quit: jest.fn().mockResolvedValue(undefined),
      };
      const client = { duplicate: () => sub };
      const { service } = makeService(runningRun, client as any);
      const res = makeRes();

      await service.relay(runId, userId, makeReq() as any, res as any);

      expect(res.writeHead).toHaveBeenCalledWith(
        200,
        expect.objectContaining({
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
        }),
      );
      const written = allWrites(res);
      expect(written).toContain('retry: 3000\n\n');
      expect(written).toContain(': hb\n\n');
    });

    it('should forward stream entries as SSE frames keyed by the redis entry id, then end on the terminal event', async () => {
      const sub = {
        xread: jest.fn().mockResolvedValueOnce(
          batch(key, [
            entry('5-0', 'step.started', { seq: 1, ts: 1, step: 'GENERATE' }),
            entry('6-0', 'run.completed', {
              seq: 2,
              ts: 2,
              artifactId: 'a1',
              version: 1,
            }),
          ]),
        ),
        quit: jest.fn().mockResolvedValue(undefined),
      };
      const client = { duplicate: () => sub };
      const { service } = makeService(runningRun, client as any);
      const res = makeRes();

      await service.relay(runId, userId, makeReq() as any, res as any);

      const written = allWrites(res);
      expect(written).toContain('id: 5-0\nevent: step.started\n');
      expect(written).toContain('id: 6-0\nevent: run.completed\n');
      expect(res.end).toHaveBeenCalled();
      expect(sub.quit).toHaveBeenCalled();
    });

    it('should write a heartbeat comment on a block timeout, then resume', async () => {
      const sub = {
        xread: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(
            batch(key, [entry('7-0', 'run.failed', { seq: 1, ts: 1 })]),
          ),
        quit: jest.fn().mockResolvedValue(undefined),
      };
      const client = { duplicate: () => sub };
      const { service } = makeService(runningRun, client as any);
      const res = makeRes();

      await service.relay(runId, userId, makeReq() as any, res as any);

      const hbFrames = res.write.mock.calls.filter((c) => c[0] === ': hb\n\n');
      // one from the initial frame, one from the timeout
      expect(hbFrames.length).toBeGreaterThanOrEqual(2);
      expect(res.end).toHaveBeenCalled();
    });

    it('should quit the duplicate connection when the request closes', async () => {
      let resolveRead: (v: unknown) => void = () => undefined;
      const sub = {
        xread: jest.fn().mockImplementation(
          () =>
            new Promise((resolve) => {
              resolveRead = resolve;
            }),
        ),
        quit: jest.fn().mockResolvedValue(undefined),
      };
      const client = { duplicate: () => sub };
      const { service } = makeService(runningRun, client as any);
      const res = makeRes();
      const req = makeReq();

      const relaying = service.relay(runId, userId, req as any, res as any);
      // Let the relay register its close handler and block on the first read.
      await new Promise((resolve) => setImmediate(resolve));
      req.close();
      resolveRead(null); // unblock the pending read so the loop can observe close
      await relaying;

      expect(sub.quit).toHaveBeenCalled();
    });
  });

  describe('terminal run reconnect', () => {
    it('should return 204 when the client is already current', async () => {
      const client = {
        xread: jest.fn().mockResolvedValue(null),
        xlen: jest.fn().mockResolvedValue(6),
      };
      const { service } = makeService(
        { ...runningRun, status: 'COMPLETED' },
        client as any,
      );
      const res = makeRes();

      await service.relay(
        runId,
        userId,
        makeReq({ 'last-event-id': '6-0' }) as any,
        res as any,
      );

      expect(client.xread).toHaveBeenCalledWith(
        'COUNT',
        expect.any(Number),
        'STREAMS',
        key,
        '6-0',
      );
      expect(res.writeHead).toHaveBeenCalledWith(204);
      expect(res.end).toHaveBeenCalled();
    });

    it('should replay the tail including the terminal event when the client is behind, then close', async () => {
      const client = {
        xread: jest
          .fn()
          .mockResolvedValueOnce(
            batch(key, [
              entry('1-0', 'run.started', { seq: 1, ts: 1 }),
              entry('2-0', 'run.completed', { seq: 2, ts: 2 }),
            ]),
          )
          .mockResolvedValueOnce(null),
        xlen: jest.fn(),
      };
      const { service } = makeService(
        { ...runningRun, status: 'COMPLETED' },
        client as any,
      );
      const res = makeRes();

      await service.relay(runId, userId, makeReq() as any, res as any);

      const written = allWrites(res);
      expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
      expect(written).toContain('id: 1-0\nevent: run.started\n');
      expect(written).toContain('id: 2-0\nevent: run.completed\n');
      expect(res.end).toHaveBeenCalled();
    });

    it('should synthesize a snapshot from the run record when the stream has expired', async () => {
      const client = {
        xread: jest.fn().mockResolvedValue(null),
        xlen: jest.fn().mockResolvedValue(0),
      };
      const { service } = makeService(
        {
          ...runningRun,
          status: 'FAILED',
          failureReason: 'Zod rejected the model output',
        },
        client as any,
      );
      const res = makeRes();

      await service.relay(runId, userId, makeReq() as any, res as any);

      const written = allWrites(res);
      expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
      expect(written).toContain('event: run.started');
      expect(written).toContain('event: run.failed');
      expect(written).toContain('Zod rejected the model output');
      expect(written).toContain(
        '"steps":["RESOLVE_INPUT","GENERATE","PERSIST_VERSION"]',
      );
      expect(res.end).toHaveBeenCalled();
    });
  });
});
