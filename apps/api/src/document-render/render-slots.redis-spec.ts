import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import IORedis from 'ioredis';
import { RenderSlotUnavailableError, RenderSlots } from './render-slots';

/**
 * The slot semaphore's Lua acquire against a real Redis. Not part of
 * `bun run check`; run it with the compose Redis up:
 * `bun run test:redis` (reads `REDIS_URL` from `.env`).
 *
 * Each test uses its own key, so it never touches the live `browserless:slots`.
 */
const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
  throw new Error(
    'test:redis needs a Redis: set REDIS_URL, e.g. start `docker compose up -d` and keep REDIS_URL in apps/api/.env',
  );
}

describe('RenderSlots against Redis', () => {
  let redis: IORedis;
  let key: string;
  const logger = { warn: jest.fn() };

  const makeSlots = (leaseMs: number) =>
    new RenderSlots({
      redis,
      key,
      limit: 2,
      maxWaitMs: 120_000,
      leaseMs,
      logger,
    });

  beforeAll(() => {
    redis = new IORedis(REDIS_URL);
  });

  beforeEach(() => {
    key = `browserless:slots:test:${randomUUID()}`;
  });

  afterEach(async () => {
    await redis.del(key);
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('should hold two slots and refuse a third when the limit is 2', async () => {
    const slots = makeSlots(75_000);

    await slots.acquire(0);
    await slots.acquire(0);
    await expect(slots.acquire(0)).rejects.toBeInstanceOf(
      RenderSlotUnavailableError,
    );
    expect(await redis.zcard(key)).toBe(2);
    expect(await redis.pttl(key)).toBeGreaterThan(70_000);
  });

  it('should free a slot when its lease is released', async () => {
    const slots = makeSlots(75_000);
    const first = await slots.acquire(0);
    await slots.acquire(0);

    await first.release();

    await expect(slots.acquire(0)).resolves.toBeDefined();
    expect(await redis.zcard(key)).toBe(2);
  });

  it('should reap an expired lease when a crashed worker never released it', async () => {
    const healthy = makeSlots(75_000);
    const crashed = makeSlots(200);
    await healthy.acquire(0);
    await crashed.acquire(0); // never released

    await sleep(300);

    await expect(healthy.acquire(0)).resolves.toBeDefined();
    // The healthy lease and the new one; the expired lease was reaped, and the
    // short lease did not pull the key's expiry in under the long ones.
    expect(await redis.zcard(key)).toBe(2);
    expect(await redis.pttl(key)).toBeGreaterThan(70_000);
  });

  it('should let a waiting render proceed when a slot comes free', async () => {
    const slots = makeSlots(75_000);
    const first = await slots.acquire(0);
    await slots.acquire(0);

    const waiting = slots.acquire(5_000);
    await sleep(400);
    await first.release();

    const lease = await waiting;
    expect(lease.waitedMs).toBeGreaterThan(0);
    expect(lease.waitedMs).toBeLessThan(5_000);
  });
});
