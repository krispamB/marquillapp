import {
  RENDER_SLOTS_KEY,
  RenderSlotUnavailableError,
  RenderSlots,
  renderSlotsSettings,
  slotPollDelayMs,
} from './render-slots';

/**
 * An in-memory stand-in for the Lua acquire: the same reap, count and add on a
 * map of token to expiry, against the test's clock instead of Redis `TIME`.
 * The script itself runs against real Redis in `render-slots.redis-spec.ts`.
 */
const makeFakeRedis = (clock: { now: number }) => {
  const sets = new Map<string, Map<string, number>>();
  const setOf = (key: string) => {
    if (!sets.has(key)) sets.set(key, new Map());
    return sets.get(key)!;
  };
  const evalFn = jest.fn(
    (
      _script: string,
      _keys: number,
      key: string,
      limit: string,
      leaseMs: string,
      token: string,
    ) => {
      const set = setOf(key);
      for (const [held, expiry] of set) {
        if (expiry <= clock.now) set.delete(held);
      }
      if (set.size >= Number(limit)) return Promise.resolve(0);
      set.set(token, clock.now + Number(leaseMs));
      return Promise.resolve(1);
    },
  );
  const zrem = jest.fn((key: string, token: string) => {
    const removed = setOf(key).delete(token);
    return Promise.resolve(removed ? 1 : 0);
  });
  return { eval: evalFn, zrem, held: (key: string) => setOf(key).size };
};

describe('RenderSlots', () => {
  const makeService = (
    overrides: { limit?: number; maxWaitMs?: number; leaseMs?: number } = {},
  ) => {
    const clock = { now: 0 };
    const redis = makeFakeRedis(clock);
    const logger = { warn: jest.fn() };
    // A sleep the test resolves by hand, so it controls what happens between
    // two polls; it advances the clock by the time slept.
    const pendingSleeps: Array<() => void> = [];
    const sleep = jest.fn((ms: number) => {
      clock.now += ms;
      return new Promise<void>((resolve) => pendingSleeps.push(resolve));
    });
    let tokens = 0;
    const slots = new RenderSlots({
      redis: redis as never,
      limit: overrides.limit ?? 2,
      maxWaitMs: overrides.maxWaitMs ?? 120_000,
      leaseMs: overrides.leaseMs ?? 75_000,
      logger,
      sleep,
      now: () => clock.now,
      random: () => 0,
      token: () => `token-${++tokens}`,
    });
    const wakeSleepers = async () => {
      // Let the waiting acquire reach its sleep before waking it.
      await new Promise((resolve) => setImmediate(resolve));
      pendingSleeps.splice(0).forEach((resolve) => resolve());
      await new Promise((resolve) => setImmediate(resolve));
    };
    return {
      slots,
      mocks: { redis, logger, sleep },
      fixtures: { clock, wakeSleepers },
    };
  };

  describe('acquire', () => {
    it('should hold a slot without waiting when one is free', async () => {
      const { slots, mocks } = makeService();

      const lease = await slots.acquire(60_000);

      expect(lease.waitedMs).toBe(0);
      expect(mocks.redis.held(RENDER_SLOTS_KEY)).toBe(1);
      expect(mocks.redis.eval).toHaveBeenCalledWith(
        expect.stringContaining("redis.call('TIME')"),
        1,
        RENDER_SLOTS_KEY,
        '2',
        '75000',
        'token-1',
      );
      expect(mocks.sleep).not.toHaveBeenCalled();
    });

    it('should make a third render wait, then proceed, when two hold the slots at limit 2', async () => {
      const { slots, mocks, fixtures } = makeService({ limit: 2 });
      const first = await slots.acquire(60_000);
      await slots.acquire(60_000);

      let third: { waitedMs: number } | undefined;
      const waiting = slots.acquire(60_000).then((lease) => (third = lease));
      await fixtures.wakeSleepers();
      expect(third).toBeUndefined();
      expect(mocks.sleep).toHaveBeenCalled();

      await first.release();
      await fixtures.wakeSleepers();
      await waiting;

      expect(third?.waitedMs).toBeGreaterThan(0);
      expect(mocks.redis.held(RENDER_SLOTS_KEY)).toBe(2);
    });

    it("should take a crashed worker's slot once its lease has expired when nobody released it", async () => {
      const { slots, fixtures } = makeService({ limit: 1, leaseMs: 75_000 });
      await slots.acquire(60_000); // never released: the worker crashed

      fixtures.clock.now += 75_000;
      const lease = await slots.acquire(60_000);

      expect(lease.waitedMs).toBe(0);
    });

    it('should throw RenderSlotUnavailableError when no slot comes free within the wait', async () => {
      const { slots, mocks, fixtures } = makeService({ limit: 1 });
      await slots.acquire(60_000);

      const waiting = slots.acquire(1_000);
      let error: unknown;
      waiting.catch((thrown: unknown) => (error = thrown));
      while (error === undefined) await fixtures.wakeSleepers();

      expect(error).toBeInstanceOf(RenderSlotUnavailableError);
      expect(error).toMatchObject({ limit: 1, waitedMs: 1_000 });
      expect(mocks.redis.held(RENDER_SLOTS_KEY)).toBe(1);
    });

    it('should wait no longer than BROWSERLESS_SLOT_WAIT_MAX_MS when the run has more time left', async () => {
      const { slots, fixtures } = makeService({ limit: 1, maxWaitMs: 2_000 });
      await slots.acquire(60_000);

      let error: unknown;
      slots.acquire(60_000).catch((thrown: unknown) => (error = thrown));
      while (error === undefined) await fixtures.wakeSleepers();

      expect(error).toMatchObject({ waitedMs: 2_000 });
    });

    it('should try once and throw without sleeping when the wait budget is zero', async () => {
      const { slots, mocks } = makeService({ limit: 1 });
      await slots.acquire(60_000);

      await expect(slots.acquire(0)).rejects.toBeInstanceOf(
        RenderSlotUnavailableError,
      );
      expect(mocks.sleep).not.toHaveBeenCalled();
    });

    it('should make no Redis call when the limit is 0', async () => {
      const { slots, mocks } = makeService({ limit: 0 });

      const lease = await slots.acquire(60_000);
      await lease.release();

      expect(lease.waitedMs).toBe(0);
      expect(mocks.redis.eval).not.toHaveBeenCalled();
      expect(mocks.redis.zrem).not.toHaveBeenCalled();
    });

    it('should fail open with a warning when Redis errors', async () => {
      const { slots, mocks } = makeService();
      mocks.redis.eval.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const lease = await slots.acquire(60_000);
      await lease.release();

      expect(lease.waitedMs).toBe(0);
      expect(mocks.redis.zrem).not.toHaveBeenCalled();
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('ECONNREFUSED'),
      );
    });

    it('should fail open when Redis errors while the render waits', async () => {
      const { slots, mocks, fixtures } = makeService({ limit: 1 });
      await slots.acquire(60_000);

      const waiting = slots.acquire(60_000);
      await new Promise((resolve) => setImmediate(resolve));
      mocks.redis.eval.mockRejectedValueOnce(new Error('READONLY'));
      await fixtures.wakeSleepers();

      await expect(waiting).resolves.toMatchObject({ waitedMs: 250 });
      expect(mocks.logger.warn).toHaveBeenCalled();
    });
  });

  describe('release', () => {
    it('should remove only its own token when released', async () => {
      const { slots, mocks } = makeService();
      const first = await slots.acquire(60_000);
      await slots.acquire(60_000);

      await first.release();
      await first.release();

      expect(mocks.redis.zrem).toHaveBeenCalledTimes(1);
      expect(mocks.redis.zrem).toHaveBeenCalledWith(
        RENDER_SLOTS_KEY,
        'token-1',
      );
      expect(mocks.redis.held(RENDER_SLOTS_KEY)).toBe(1);
    });

    it('should log and swallow a Redis error when the release fails', async () => {
      const { slots, mocks } = makeService();
      const lease = await slots.acquire(60_000);
      mocks.redis.zrem.mockRejectedValueOnce(new Error('ETIMEDOUT'));

      await expect(lease.release()).resolves.toBeUndefined();
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('ETIMEDOUT'),
      );
    });
  });
});

describe('slotPollDelayMs', () => {
  it('should pause 250 to 500 ms when the first try found no slot', () => {
    expect(slotPollDelayMs(0, () => 0)).toBe(250);
    expect(slotPollDelayMs(0, () => 1)).toBe(500);
  });

  it('should pause 500 ms to 1 s when a later try found no slot', () => {
    expect(slotPollDelayMs(1, () => 0)).toBe(500);
    expect(slotPollDelayMs(1, () => 1)).toBe(1_000);
    expect(slotPollDelayMs(9, () => 1)).toBe(1_000);
  });
});

describe('renderSlotsSettings', () => {
  it('should disable the semaphore and wait up to 120 s when the keys are unset', () => {
    expect(renderSlotsSettings({})).toEqual({
      limit: 0,
      maxWaitMs: 120_000,
      leaseMs: 75_000,
    });
  });

  it('should read the limit and the wait when they are set', () => {
    expect(
      renderSlotsSettings({
        BROWSERLESS_MAX_CONCURRENT_SESSIONS: '2',
        BROWSERLESS_SLOT_WAIT_MAX_MS: '30000',
      }),
    ).toMatchObject({ limit: 2, maxWaitMs: 30_000 });
  });

  it('should throw naming the key when a value is not an integer', () => {
    expect(() =>
      renderSlotsSettings({ BROWSERLESS_MAX_CONCURRENT_SESSIONS: 'two' }),
    ).toThrow('BROWSERLESS_MAX_CONCURRENT_SESSIONS');
  });
});
