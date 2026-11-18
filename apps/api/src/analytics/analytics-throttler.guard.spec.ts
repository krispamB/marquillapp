import { ThrottlerGuard } from '@nestjs/throttler';
import type { ThrottlerRequest } from '@nestjs/throttler';
import {
  ANALYTICS_REFRESH_LIMIT,
  ANALYTICS_REFRESH_TTL_MS,
  AnalyticsThrottlerGuard,
} from './analytics-throttler.guard';

type HandleRequest = (props: ThrottlerRequest) => Promise<boolean>;

const makeGuard = () => {
  const guard = Object.create(
    AnalyticsThrottlerGuard.prototype,
  ) as AnalyticsThrottlerGuard;
  const parent = jest
    .spyOn(
      ThrottlerGuard.prototype as unknown as { handleRequest: HandleRequest },
      'handleRequest',
    )
    .mockResolvedValue(true);
  const handleRequest = (
    guard as unknown as { handleRequest: HandleRequest }
  ).handleRequest.bind(guard) as HandleRequest;
  return { handleRequest, mocks: { parent } };
};

const requestProps = (query: Record<string, string>): ThrottlerRequest => {
  const req = { query };
  const context = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
  };
  return {
    context,
    limit: 120,
    ttl: 60_000,
    throttler: { name: 'default', limit: 120, ttl: 60_000 },
    blockDuration: 60_000,
    getTracker: jest.fn(),
    generateKey: (_ctx: unknown, tracker: string, name: string) =>
      `${name}-${tracker}`,
  } as unknown as ThrottlerRequest;
};

describe('AnalyticsThrottlerGuard', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('handleRequest', () => {
    it('should keep the default limit when the read is not a refresh', async () => {
      const { handleRequest, mocks } = makeGuard();
      const props = requestProps({ range: '7d' });

      await handleRequest(props);

      expect(mocks.parent).toHaveBeenCalledWith(props);
    });

    it('should use a tighter, separate bucket when refresh is true', async () => {
      const { handleRequest, mocks } = makeGuard();
      const props = requestProps({ refresh: 'true' });

      await handleRequest(props);

      const passed = mocks.parent.mock.calls[0][0];
      expect(passed.limit).toBe(ANALYTICS_REFRESH_LIMIT);
      expect(passed.ttl).toBe(ANALYTICS_REFRESH_TTL_MS);
      expect(passed.generateKey(props.context, 'user:1', 'default')).toBe(
        'default-user:1:refresh',
      );
    });
  });
});
