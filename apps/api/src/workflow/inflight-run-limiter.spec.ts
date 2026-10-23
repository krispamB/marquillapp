import { ConfigService } from '@nestjs/config';
import { HttpStatus } from '@nestjs/common';
import {
  InflightRunLimiter,
  REFRESH_SCRIPT,
  RESERVE_SCRIPT,
} from './inflight-run-limiter';
import { RunTooManyInFlightException } from './run-too-many-in-flight.exception';

const makeLimiter = (env: Record<string, string | undefined> = {}) => {
  const client = {
    eval: jest.fn().mockResolvedValue(1),
    zrem: jest.fn().mockResolvedValue(1),
  };
  const redis = { getClient: jest.fn().mockReturnValue(client) };
  const limiter = new InflightRunLimiter(
    new ConfigService(env),
    redis as never,
  );
  return { limiter, client, redis };
};

describe('InflightRunLimiter', () => {
  describe('with MAX_INFLIGHT_RUNS_PER_USER unset or 0', () => {
    it.each([{}, { MAX_INFLIGHT_RUNS_PER_USER: '0' }])(
      'should make no Redis call on reserve, refresh or release (%j)',
      async (env) => {
        const { limiter, redis } = makeLimiter(env);

        await limiter.reserve('u1', 'r1');
        await limiter.refresh('u1', 'r1');
        await limiter.release('u1', 'r1');

        expect(redis.getClient).not.toHaveBeenCalled();
      },
    );
  });

  describe('reserve', () => {
    it("should run the reserve script on the user's key with the limit, lease and run id when the cap is on", async () => {
      const { limiter, client } = makeLimiter({
        MAX_INFLIGHT_RUNS_PER_USER: '3',
        RUN_INFLIGHT_LEASE_SECONDS: '60',
      });

      await limiter.reserve('u1', 'r1');

      expect(client.eval).toHaveBeenCalledWith(
        RESERVE_SCRIPT,
        1,
        'workflow:inflight:u1',
        3,
        60_000,
        'r1',
      );
    });

    it('should default the lease to 1800 seconds when RUN_INFLIGHT_LEASE_SECONDS is unset', async () => {
      const { limiter, client } = makeLimiter({
        MAX_INFLIGHT_RUNS_PER_USER: '3',
      });

      await limiter.reserve('u1', 'r1');

      expect((client.eval.mock.calls[0] as unknown[])[4]).toBe(1_800_000);
    });

    it('should throw a 429 run.too_many_in_flight carrying the limit when the script rejects', async () => {
      const { limiter, client } = makeLimiter({
        MAX_INFLIGHT_RUNS_PER_USER: '2',
      });
      client.eval.mockResolvedValue(0);

      const error: unknown = await limiter
        .reserve('u1', 'r1')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(RunTooManyInFlightException);
      const exception = error as RunTooManyInFlightException;
      expect(exception.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(exception.getResponse()).toEqual({
        statusCode: 429,
        code: 'run.too_many_in_flight',
        limit: 2,
        message: exception.message,
      });
    });

    it('should allow the launch when Redis fails', async () => {
      const { limiter, client } = makeLimiter({
        MAX_INFLIGHT_RUNS_PER_USER: '2',
      });
      client.eval.mockRejectedValue(new Error('ECONNRESET'));

      await expect(limiter.reserve('u1', 'r1')).resolves.toBeUndefined();
    });
  });

  describe('release', () => {
    it("should remove the run id from the user's set when the run ends", async () => {
      const { limiter, client } = makeLimiter({
        MAX_INFLIGHT_RUNS_PER_USER: '2',
      });

      await limiter.release('u1', 'r1');

      expect(client.zrem).toHaveBeenCalledWith('workflow:inflight:u1', 'r1');
    });

    it('should resolve when the Redis release fails', async () => {
      const { limiter, client } = makeLimiter({
        MAX_INFLIGHT_RUNS_PER_USER: '2',
      });
      client.zrem.mockRejectedValue(new Error('ECONNRESET'));

      await expect(limiter.release('u1', 'r1')).resolves.toBeUndefined();
    });
  });

  describe('refresh', () => {
    it('should run the refresh script with the lease and run id when a job attempt starts', async () => {
      const { limiter, client } = makeLimiter({
        MAX_INFLIGHT_RUNS_PER_USER: '2',
        RUN_INFLIGHT_LEASE_SECONDS: '30',
      });

      await limiter.refresh('u1', 'r1');

      expect(client.eval).toHaveBeenCalledWith(
        REFRESH_SCRIPT,
        1,
        'workflow:inflight:u1',
        30_000,
        'r1',
      );
    });

    it('should resolve when the Redis refresh fails', async () => {
      const { limiter, client } = makeLimiter({
        MAX_INFLIGHT_RUNS_PER_USER: '2',
      });
      client.eval.mockRejectedValue(new Error('ECONNRESET'));

      await expect(limiter.refresh('u1', 'r1')).resolves.toBeUndefined();
    });
  });

  describe('configuration', () => {
    it.each([
      { MAX_INFLIGHT_RUNS_PER_USER: '-1' },
      { MAX_INFLIGHT_RUNS_PER_USER: 'many' },
      { RUN_INFLIGHT_LEASE_SECONDS: '0' },
      { RUN_INFLIGHT_LEASE_SECONDS: 'soon' },
    ])('should fail construction naming the key for %j', (env) => {
      expect(() => makeLimiter(env)).toThrow(/MAX_INFLIGHT|RUN_INFLIGHT/);
    });
  });
});
