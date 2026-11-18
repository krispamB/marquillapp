import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ApiError } from '../common/HelperFn/apiFetch.helper';
import { LinkedinAccountType } from '../database/schemas/connected-account.schema';
import type { User } from '../database/schemas/user.schema';
import { AnalyticsService } from './analytics.service';
import {
  fakeLinkedinApi,
  memberDay,
  type FakeLinkedinApi,
} from './fake-linkedin-api.mock-spec';

const now = new Date('2026-11-11T09:12:44.000Z');

const leanChain = (result: unknown) => {
  const exec = jest.fn().mockResolvedValue(result);
  const lean = jest.fn().mockReturnValue({ exec });
  const select = jest.fn().mockReturnValue({ lean });
  const limit = jest.fn().mockReturnValue({ select });
  const sort = jest.fn().mockReturnValue({ limit, select });
  return { sort, select, limit, lean, exec };
};

const makeService = (env: Record<string, string> = {}) => {
  const userId = new Types.ObjectId();
  const accountId = new Types.ObjectId();
  const account = {
    _id: accountId,
    user: userId,
    accountType: LinkedinAccountType.PERSON,
    displayName: 'Ada Lovelace',
    avatarUrl: 'https://media.example/ada.jpg',
    externalId: 'member-1',
    accessToken: 'encrypted-token',
    accessTokenExpiresAt: new Date('2027-01-01T00:00:00Z'),
    analyticsAccessToken: 'encrypted-analytics-token' as string | null,
    analyticsAccessTokenExpiresAt: new Date('2027-01-01T00:00:00Z'),
    isActive: true,
  };
  const accountQuery = (result: unknown) => ({
    select: jest.fn().mockResolvedValue(result),
  });
  const connectedAccountModel = {
    findOne: jest.fn(() => accountQuery(account)),
  };
  const postChain = leanChain([]);
  const postModel = { find: jest.fn().mockReturnValue(postChain) };
  const artifactChain = leanChain([]);
  const artifactModel = { find: jest.fn().mockReturnValue(artifactChain) };
  const encryptionService = {
    decrypt: jest.fn().mockResolvedValue('plain-token'),
  };
  const api: FakeLinkedinApi = fakeLinkedinApi();
  const linkedinClient = { session: jest.fn().mockReturnValue(api) };
  const store = new Map<string, unknown>();
  const cache = {
    get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: jest.fn((key: string, value: unknown) => {
      store.set(key, value);
      return Promise.resolve();
    }),
  };
  const configService = { ...env };
  const service = new AnalyticsService(
    connectedAccountModel as any,
    postModel as any,
    artifactModel as any,
    encryptionService as any,
    linkedinClient as any,
    cache as any,
    configService as any,
  );
  return {
    service,
    mocks: {
      connectedAccountModel,
      postModel,
      postChain,
      artifactModel,
      artifactChain,
      encryptionService,
      linkedinClient,
      api,
      cache,
      store,
    },
    fixtures: {
      user: { _id: userId } as unknown as User,
      account,
      accountId: accountId.toHexString(),
    },
  };
};

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let mocks: ReturnType<typeof makeService>['mocks'];
  let fixtures: ReturnType<typeof makeService>['fixtures'];

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(now);
    jest.clearAllMocks();
    ({ service, mocks, fixtures } = makeService());
  });
  afterEach(() => jest.useRealTimers());

  const setCalls = () =>
    mocks.cache.set.mock.calls.map(([key, , ttl]) => [
      String(key).split(':').slice(0, 3).join(':') === 'analytics:v1:last-good'
        ? 'last-good'
        : 'main',
      ttl,
    ]);

  describe('getOverview', () => {
    it('should 404 when the account is not the caller’s', async () => {
      mocks.connectedAccountModel.findOne.mockReturnValue({
        select: jest.fn().mockResolvedValue(null),
      } as any);
      await expect(
        service.getOverview(fixtures.user, fixtures.accountId),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mocks.connectedAccountModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ user: fixtures.user._id }),
      );
    });

    it('should return reconnect_required without calling LinkedIn or caching when the token expired', async () => {
      fixtures.account.accessTokenExpiresAt = new Date('2026-11-01T00:00:00Z');

      const result = await service.getOverview(
        fixtures.user,
        fixtures.accountId,
      );

      expect(result).toMatchObject({
        access: 'reconnect_required',
        followers: { total: null, gained: null },
        series: [],
        unavailable: [],
        fetchedAt: now.toISOString(),
      });
      expect(result.metrics.impressions).toBeNull();
      expect(mocks.linkedinClient.session).not.toHaveBeenCalled();
      expect(mocks.cache.set).not.toHaveBeenCalled();
    });

    it('should fetch, cache for the configured TTL and keep a last-good copy when the data is ok', async () => {
      mocks.api.memberFollowersTotal.mockResolvedValue([
        { memberFollowersCount: 10 },
      ]);
      mocks.api.memberPostAnalytics.mockResolvedValue([
        memberDay('2026-11-10', 5),
      ]);

      const result = await service.getOverview(
        fixtures.user,
        fixtures.accountId,
        '28d',
      );

      expect(mocks.linkedinClient.session).toHaveBeenCalledWith('plain-token');
      expect(result).toMatchObject({
        account: {
          id: fixtures.accountId,
          accountType: 'PERSON',
          displayName: 'Ada Lovelace',
          avatarUrl: 'https://media.example/ada.jpg',
        },
        access: 'ok',
        cached: false,
        fetchedAt: now.toISOString(),
        range: { key: '28d', start: '2026-10-14', end: '2026-11-10' },
        followers: { total: 10 },
      });
      expect(result.series).toHaveLength(28);
      expect(setCalls()).toEqual([
        ['main', 3600],
        ['last-good', 7 * 24 * 60 * 60],
      ]);
      const [mainKey] = mocks.cache.set.mock.calls[0];
      expect(mainKey).toMatch(
        new RegExp(
          `^analytics:v1:${fixtures.accountId}:[0-9a-f]{12}:overview:28d:2026-11-10$`,
        ),
      );
    });

    it('should serve a cached copy with cached true and the live account details', async () => {
      await service.getOverview(fixtures.user, fixtures.accountId);
      fixtures.account.displayName = 'Ada King';
      mocks.linkedinClient.session.mockClear();

      const result = await service.getOverview(
        fixtures.user,
        fixtures.accountId,
      );

      expect(result.cached).toBe(true);
      expect(result.account.displayName).toBe('Ada King');
      expect(mocks.linkedinClient.session).not.toHaveBeenCalled();
    });

    it('should bypass and overwrite the cache when refresh is true', async () => {
      await service.getOverview(fixtures.user, fixtures.accountId);
      mocks.cache.get.mockClear();

      const result = await service.getOverview(
        fixtures.user,
        fixtures.accountId,
        '28d',
        true,
      );

      expect(result.cached).toBe(false);
      expect(mocks.linkedinClient.session).toHaveBeenCalledTimes(2);
      expect(mocks.cache.get).not.toHaveBeenCalled();
    });

    it('should share one LinkedIn fetch between identical concurrent requests', async () => {
      const [a, b] = await Promise.all([
        service.getOverview(fixtures.user, fixtures.accountId),
        service.getOverview(fixtures.user, fixtures.accountId),
      ]);

      expect(mocks.linkedinClient.session).toHaveBeenCalledTimes(1);
      expect(mocks.api.memberFollowersTotal).toHaveBeenCalledTimes(1);
      expect(a.fetchedAt).toBe(b.fetchedAt);
    });

    it('should cache missing_scope briefly when every member call is forbidden', async () => {
      const forbidden = () =>
        Promise.reject(new ApiError(403, 'Forbidden', {}));
      for (const fn of Object.values(mocks.api)) {
        fn.mockImplementation(forbidden);
      }

      const result = await service.getOverview(
        fixtures.user,
        fixtures.accountId,
      );

      expect(result.access).toBe('missing_scope');
      expect(result.series).toEqual([]);
      expect(setCalls()).toEqual([['main', 600]]);
    });

    it('should report not_admin for an organization whose calls are all forbidden', async () => {
      fixtures.account.accountType = LinkedinAccountType.ORGANIZATION;
      for (const fn of Object.values(mocks.api)) {
        fn.mockRejectedValue(new ApiError(403, 'Forbidden', {}));
      }

      const result = await service.getOverview(
        fixtures.user,
        fixtures.accountId,
      );

      expect(result.access).toBe('not_admin');
      expect(mocks.api.organizationShareStatsDaily).toHaveBeenCalledWith(
        'urn:li:organization:member-1',
        expect.any(Object),
      );
    });

    it('should return missing_scope without calling LinkedIn when a member has not granted analytics', async () => {
      fixtures.account.analyticsAccessToken = null;

      const result = await service.getOverview(
        fixtures.user,
        fixtures.accountId,
      );

      expect(result.access).toBe('missing_scope');
      expect(mocks.linkedinClient.session).not.toHaveBeenCalled();
      expect(mocks.cache.set).not.toHaveBeenCalled();
    });

    it('should read a member with the analytics token and a page with the main one', async () => {
      await service.getOverview(fixtures.user, fixtures.accountId);
      expect(mocks.encryptionService.decrypt).toHaveBeenLastCalledWith(
        'encrypted-analytics-token',
      );

      fixtures.account.accountType = LinkedinAccountType.ORGANIZATION;
      fixtures.account.analyticsAccessToken = null;
      await service.getOverview(fixtures.user, fixtures.accountId);
      expect(mocks.encryptionService.decrypt).toHaveBeenLastCalledWith(
        'encrypted-token',
      );
    });

    it('should ask a member to grant analytics again when LinkedIn answers 401', async () => {
      mocks.api.memberFollowersTotal.mockRejectedValue(
        new ApiError(401, 'Unauthorized', {}),
      );

      const result = await service.getOverview(
        fixtures.user,
        fixtures.accountId,
      );

      expect(result.access).toBe('missing_scope');
      expect(mocks.linkedinClient.session).toHaveBeenCalledWith('plain-token');
    });

    it('should serve the last good copy when LinkedIn fails entirely', async () => {
      await service.getOverview(fixtures.user, fixtures.accountId);
      const firstFetchedAt = now.toISOString();
      jest.setSystemTime(new Date('2026-11-12T09:00:00Z'));
      for (const fn of Object.values(mocks.api)) {
        fn.mockRejectedValue(new ApiError(429, 'Too Many', {}));
      }

      const result = await service.getOverview(
        fixtures.user,
        fixtures.accountId,
      );

      expect(result.access).toBe('ok');
      expect(result.cached).toBe(true);
      expect(result.fetchedAt).toBe(firstFetchedAt);
    });

    it('should return unavailable and cache it for a minute when there is no stale copy', async () => {
      for (const fn of Object.values(mocks.api)) {
        fn.mockRejectedValue(new ApiError(503, 'Unavailable', {}));
      }

      const result = await service.getOverview(
        fixtures.user,
        fixtures.accountId,
      );

      expect(result.access).toBe('unavailable');
      expect(result.metrics.impressions).toBeNull();
      expect(setCalls()).toEqual([['main', 60]]);
    });

    it('should cache a partial result only briefly when a section failed transiently', async () => {
      mocks.api.memberFollowersTotal.mockRejectedValue(
        new ApiError(503, 'Unavailable', {}),
      );

      const result = await service.getOverview(
        fixtures.user,
        fixtures.accountId,
      );

      expect(result.access).toBe('ok');
      expect(result.unavailable).toEqual(['followers.total']);
      expect(setCalls()).toEqual([
        ['main', 300],
        ['last-good', 7 * 24 * 60 * 60],
      ]);
    });

    it('should return missing_scope when a member’s analytics token will not decrypt', async () => {
      mocks.encryptionService.decrypt.mockRejectedValue(new Error('bad tag'));

      const result = await service.getOverview(
        fixtures.user,
        fixtures.accountId,
      );

      expect(result.access).toBe('missing_scope');
    });

    it('should honour the TTL from the environment', async () => {
      ({ service, mocks, fixtures } = makeService({
        ANALYTICS_OVERVIEW_CACHE_TTL_SECONDS: '120',
      }));

      await service.getOverview(fixtures.user, fixtures.accountId);

      expect(setCalls()[0]).toEqual(['main', 120]);
    });
  });

  describe('getPosts', () => {
    it('should report Marquill posts for a member with their pinned commentary', async () => {
      const artifactId = new Types.ObjectId();
      const postId = new Types.ObjectId();
      mocks.postChain.exec.mockResolvedValue([
        {
          _id: postId,
          title: 'Launch',
          channelPostId: 'urn:li:share:7',
          publishedAt: new Date('2026-11-01T08:00:00Z'),
          artifacts: [{ artifact: artifactId, version: 2 }],
        },
        {
          _id: new Types.ObjectId(),
          title: 'Fallback title',
          channelPostId: 'urn:li:ugcPost:8',
          publishedAt: new Date('2026-10-30T08:00:00Z'),
          artifacts: [],
        },
      ]);
      mocks.artifactChain.exec.mockResolvedValue([
        {
          _id: artifactId,
          versions: [
            { version: 1, content: { commentary: 'old' } },
            { version: 2, content: { commentary: 'Pinned text' } },
          ],
        },
      ]);
      mocks.api.memberPostLifetime.mockResolvedValue([{ count: 10 }]);

      const result = await service.getPosts(fixtures.user, fixtures.accountId);

      expect(mocks.postModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'PUBLISHED',
          publishedAt: {
            $gte: new Date('2026-10-14T00:00:00Z'),
            $lt: new Date('2026-11-11T00:00:00Z'),
          },
        }),
      );
      expect(mocks.postChain.limit).toHaveBeenCalledWith(11);
      expect(result).toMatchObject({
        access: 'ok',
        coverage: 'marquill_posts',
        truncated: false,
      });
      expect(result.posts).toEqual([
        expect.objectContaining({
          urn: 'urn:li:share:7',
          postId: postId.toHexString(),
          text: 'Pinned text',
          publishedAt: '2026-11-01T08:00:00.000Z',
          reposts: null,
          clicks: null,
          engagementRate: 200,
        }),
        expect.objectContaining({
          urn: 'urn:li:ugcPost:8',
          text: 'Fallback title',
        }),
      ]);
      expect(mocks.api.memberPostLifetime).toHaveBeenCalledTimes(6);
    });

    it('should mark a member truncated when more than 10 posts qualify', async () => {
      mocks.postChain.exec.mockResolvedValue(
        Array.from({ length: 11 }, (_, i) => ({
          _id: new Types.ObjectId(),
          channelPostId: `urn:li:share:${i}`,
          publishedAt: new Date('2026-11-01T08:00:00Z'),
          artifacts: [],
        })),
      );

      const result = await service.getPosts(fixtures.user, fixtures.accountId);

      expect(result.truncated).toBe(true);
      expect(result.posts).toHaveLength(10);
      expect(mocks.api.memberPostLifetime).toHaveBeenCalledTimes(30);
    });

    it('should list every page post for an organization and match Marquill ids', async () => {
      fixtures.account.accountType = LinkedinAccountType.ORGANIZATION;
      const marquillId = new Types.ObjectId();
      mocks.postChain.exec.mockResolvedValue([
        { _id: marquillId, channelPostId: 'urn:li:share:1' },
      ]);
      mocks.api.organizationPosts.mockResolvedValue([
        {
          id: 'urn:li:share:1',
          lifecycleState: 'PUBLISHED',
          distribution: { feedDistribution: 'MAIN_FEED' },
          publishedAt: Date.parse('2026-11-02T10:00:00Z'),
          commentary: 'Hello',
        },
      ]);

      const result = await service.getPosts(fixtures.user, fixtures.accountId);

      expect(result.coverage).toBe('all_posts');
      expect(result.posts[0]).toMatchObject({
        postId: marquillId.toHexString(),
        impressions: 0,
        clicks: 0,
      });
    });
  });

  describe('getAudience', () => {
    it('should say unsupported for a member without calling LinkedIn', async () => {
      const result = await service.getAudience(
        fixtures.user,
        fixtures.accountId,
      );

      expect(result).toEqual({
        access: 'ok',
        supported: false,
        fetchedAt: now.toISOString(),
        cached: false,
        totalFollowers: null,
        facets: [],
      });
      expect(mocks.linkedinClient.session).not.toHaveBeenCalled();
    });

    it('should build an organization audience and cache it for a day', async () => {
      fixtures.account.accountType = LinkedinAccountType.ORGANIZATION;
      mocks.api.organizationNetworkSize.mockResolvedValue({
        firstDegreeSize: 4821,
      });

      const result = await service.getAudience(
        fixtures.user,
        fixtures.accountId,
      );

      expect(result).toMatchObject({
        access: 'ok',
        supported: true,
        totalFollowers: 4821,
        facets: [],
      });
      expect(setCalls()[0]).toEqual(['main', 86400]);
    });
  });
});
