import { ApiError } from '../common/HelperFn/apiFetch.helper';
import { computeRange } from './analytics-range';
import {
  fakeLinkedinApi,
  timeRangeOf,
  type FakeLinkedinApi,
} from './fake-linkedin-api.mock-spec';
import {
  buildOrganizationAudience,
  buildOrganizationOverview,
  buildOrganizationPosts,
  qualifyingPosts,
} from './organization-analytics';

const ORG = 'urn:li:organization:123';
// 7d range on 2026-11-11: current 11-04..11-10, previous 10-28..11-03.
const range = computeRange('7d', Date.parse('2026-11-11T09:00:00Z'));
const TODAY = '2026-11-11';
const at = (iso: string) => Date.parse(iso);

describe('organization-analytics', () => {
  let api: FakeLinkedinApi;

  beforeEach(() => {
    api = fakeLinkedinApi();
  });

  describe('buildOrganizationOverview', () => {
    it('should make 4 calls and fill every contract field', async () => {
      api.organizationNetworkSize.mockResolvedValue({ firstDegreeSize: 4821 });
      api.organizationFollowerGains.mockResolvedValue([
        {
          timeRange: timeRangeOf('2026-10-29'),
          followerGains: { organicFollowerGain: 2, paidFollowerGain: 1 },
        },
        {
          timeRange: timeRangeOf('2026-11-05'),
          followerGains: { organicFollowerGain: 6, paidFollowerGain: 0 },
        },
      ]);
      api.organizationShareStatsDaily.mockResolvedValue([
        {
          timeRange: timeRangeOf('2026-10-28'),
          totalShareStatistics: {
            impressionCount: 100,
            uniqueImpressionsCount: 50,
            clickCount: 1,
            likeCount: 1,
            commentCount: 0,
            shareCount: 0,
          },
        },
        {
          timeRange: timeRangeOf('2026-11-04'),
          totalShareStatistics: {
            impressionCount: 200,
            uniqueImpressionsCount: 120,
            clickCount: 4,
            likeCount: 3,
            commentCount: 2,
            shareCount: 1,
          },
        },
        {
          timeRange: timeRangeOf('2026-11-05'),
          totalShareStatistics: { impressionCount: 0, likeCount: -1 },
        },
      ]);
      api.organizationPageStatsDaily.mockResolvedValue([
        {
          timeRange: timeRangeOf('2026-11-06'),
          totalPageStatistics: { views: { allPageViews: { pageViews: 7 } } },
        },
      ]);

      const { body, sections } = await buildOrganizationOverview(
        api,
        ORG,
        range,
        TODAY,
      );

      expect(sections).toHaveLength(4);
      const window = { start: '2026-10-28', endExclusive: '2026-11-11' };
      expect(api.organizationShareStatsDaily).toHaveBeenCalledWith(ORG, window);
      expect(body.followers).toEqual({
        total: 4821,
        gained: { value: 6, previous: 3, changePct: 100 },
      });
      expect(body.metrics.impressions).toEqual({
        value: 200,
        previous: 100,
        changePct: 100,
      });
      expect(body.metrics.uniqueImpressions?.value).toBe(120);
      // Daily likes 3 and -1 sum to 2.
      expect(body.metrics.reactions?.value).toBe(2);
      expect(body.metrics.clicks?.value).toBe(4);
      expect(body.metrics.pageViews).toEqual({
        value: 7,
        previous: 0,
        changePct: null,
      });
      // (2 + 2 + 1 + 4) / 200 and (1 + 0 + 0 + 1) / 100.
      expect(body.metrics.engagementRate).toEqual({
        value: 4.5,
        previous: 2,
        changePct: 125,
      });
      expect(body.metrics.membersReached).toBeNull();
      expect(body.unavailable).toEqual([]);

      expect(body.series).toHaveLength(7);
      expect(body.series[1]).toMatchObject({
        date: '2026-11-05',
        reactions: -1,
        followersGained: 6,
      });
      // Follower gains after today − 2 (11-09) are not published: null.
      expect(body.series[5]).toMatchObject({
        date: '2026-11-09',
        followersGained: 0,
      });
      expect(body.series[6]).toMatchObject({
        date: '2026-11-10',
        followersGained: null,
        impressions: 0,
        pageViews: 0,
      });
    });

    it('should list unique impressions as unavailable when LinkedIn omits them', async () => {
      api.organizationShareStatsDaily.mockResolvedValue([
        {
          timeRange: timeRangeOf('2026-11-04'),
          totalShareStatistics: { impressionCount: 10 },
        },
      ]);

      const { body } = await buildOrganizationOverview(api, ORG, range, TODAY);

      expect(body.metrics.uniqueImpressions).toBeNull();
      expect(body.metrics.impressions?.value).toBe(10);
      expect(body.unavailable).toContain('uniqueImpressions');
    });

    it('should null every share metric when the share statistics call fails', async () => {
      api.organizationShareStatsDaily.mockRejectedValue(
        new ApiError(429, '', {}),
      );

      const { body } = await buildOrganizationOverview(api, ORG, range, TODAY);

      for (const key of [
        'impressions',
        'uniqueImpressions',
        'clicks',
        'reactions',
        'comments',
        'reposts',
        'engagementRate',
      ] as const) {
        expect(body.metrics[key]).toBeNull();
        expect(body.unavailable).toContain(key);
      }
      expect(body.series[0].impressions).toBeNull();
      expect(body.series[0].pageViews).toBe(0);
    });
  });

  describe('qualifyingPosts', () => {
    it('should keep only published main-feed posts inside the range', () => {
      const inRange = at('2026-11-05T10:00:00Z');
      const posts = qualifyingPosts(
        [
          {
            id: 'urn:li:share:1',
            lifecycleState: 'PUBLISHED',
            distribution: { feedDistribution: 'MAIN_FEED' },
            publishedAt: inRange,
            commentary: 'Hi {hashtag|\\#|ai}',
          },
          {
            id: 'urn:li:share:2',
            lifecycleState: 'DRAFT',
            distribution: { feedDistribution: 'MAIN_FEED' },
            publishedAt: inRange,
          },
          {
            id: 'urn:li:share:3',
            lifecycleState: 'PUBLISHED',
            distribution: { feedDistribution: 'NONE' },
            publishedAt: inRange,
          },
          {
            id: 'urn:li:share:4',
            lifecycleState: 'PUBLISHED',
            distribution: { feedDistribution: 'MAIN_FEED' },
            publishedAt: at('2026-11-11T00:00:00Z'),
          },
        ],
        range,
      );
      expect(posts).toEqual([
        { urn: 'urn:li:share:1', publishedMs: inRange, text: 'Hi #ai' },
      ]);
    });
  });

  describe('buildOrganizationPosts', () => {
    const post = (n: number, iso: string, type = 'share') => ({
      id: `urn:li:${type}:${n}`,
      lifecycleState: 'PUBLISHED',
      distribution: { feedDistribution: 'MAIN_FEED' },
      publishedAt: at(iso),
      createdAt: at(iso),
      commentary: `post ${n}`,
    });

    it('should list one page, chunk stats by URN type and match Marquill posts', async () => {
      api.organizationPosts.mockResolvedValue([
        post(1, '2026-11-08T10:00:00Z'),
        post(2, '2026-11-06T10:00:00Z', 'ugcPost'),
        post(3, '2026-10-01T10:00:00Z'),
      ]);
      api.organizationPostStats.mockImplementation(
        (_org: string, urns: { shares?: string[] }) =>
          Promise.resolve(
            urns.shares
              ? [
                  {
                    share: 'urn:li:share:1',
                    totalShareStatistics: {
                      impressionCount: 50,
                      likeCount: 2,
                      commentCount: 1,
                      shareCount: 1,
                      clickCount: 1,
                    },
                  },
                ]
              : [],
          ),
      );
      const lookup = jest
        .fn()
        .mockResolvedValue(new Map([['urn:li:share:1', 'post-1']]));

      const { rows, truncated, sections } = await buildOrganizationPosts(
        api,
        ORG,
        range,
        lookup,
      );

      expect(api.organizationPosts).toHaveBeenCalledTimes(1);
      expect(api.organizationPosts).toHaveBeenCalledWith(ORG, 0, 50);
      expect(api.organizationPostStats).toHaveBeenCalledWith(ORG, {
        shares: ['urn:li:share:1'],
      });
      expect(api.organizationPostStats).toHaveBeenCalledWith(ORG, {
        ugcPosts: ['urn:li:ugcPost:2'],
      });
      expect(sections).toHaveLength(3);
      expect(truncated).toBe(false);
      expect(rows).toEqual([
        {
          urn: 'urn:li:share:1',
          postId: 'post-1',
          text: 'post 1',
          publishedAt: '2026-11-08T10:00:00.000Z',
          url: 'https://www.linkedin.com/feed/update/urn:li:share:1/',
          impressions: 50,
          reactions: 2,
          comments: 1,
          reposts: 1,
          clicks: 1,
          engagementRate: 10,
        },
        expect.objectContaining({
          urn: 'urn:li:ugcPost:2',
          postId: null,
          impressions: 0,
          engagementRate: null,
        }),
      ]);
    });

    it('should fetch a second page only while the first is full and still in range, and mark truncation', async () => {
      const page = (offset: number) =>
        Array.from({ length: 50 }, (_, i) =>
          post(offset + i, '2026-11-09T10:00:00Z'),
        );
      api.organizationPosts
        .mockResolvedValueOnce(page(0))
        .mockResolvedValueOnce(page(50));

      const { rows, truncated } = await buildOrganizationPosts(
        api,
        ORG,
        range,
        jest.fn().mockResolvedValue(new Map()),
      );

      expect(api.organizationPosts).toHaveBeenCalledTimes(2);
      expect(api.organizationPosts).toHaveBeenLastCalledWith(ORG, 50, 50);
      expect(rows).toHaveLength(50);
      expect(truncated).toBe(true);
      // 50 share URNs → 3 calls of at most 20.
      expect(api.organizationPostStats).toHaveBeenCalledTimes(3);
      expect(
        (
          api.organizationPostStats.mock.calls as Array<
            [string, { shares: string[] }]
          >
        ).map(([, urns]) => urns.shares.length),
      ).toEqual([20, 20, 10]);
    });

    it('should not page past the range start', async () => {
      const page = Array.from({ length: 50 }, (_, i) =>
        post(i, i < 10 ? '2026-11-09T10:00:00Z' : '2026-10-01T10:00:00Z'),
      );
      api.organizationPosts.mockResolvedValueOnce(page);

      const { rows, truncated } = await buildOrganizationPosts(
        api,
        ORG,
        range,
        jest.fn().mockResolvedValue(new Map()),
      );

      expect(api.organizationPosts).toHaveBeenCalledTimes(1);
      expect(rows).toHaveLength(10);
      expect(truncated).toBe(false);
    });

    it('should return no rows when the post listing fails', async () => {
      api.organizationPosts.mockRejectedValue(new ApiError(403, '', {}));

      const { rows, sections } = await buildOrganizationPosts(
        api,
        ORG,
        range,
        jest.fn(),
      );

      expect(rows).toEqual([]);
      expect(sections).toEqual([
        expect.objectContaining({ ok: false, failure: 'forbidden' }),
      ]);
      expect(api.organizationPostStats).not.toHaveBeenCalled();
    });

    it('should leave figures null for posts whose statistics call failed', async () => {
      api.organizationPosts.mockResolvedValue([
        post(1, '2026-11-08T10:00:00Z'),
      ]);
      api.organizationPostStats.mockRejectedValue(new ApiError(500, '', {}));

      const { rows } = await buildOrganizationPosts(
        api,
        ORG,
        range,
        jest.fn().mockResolvedValue(new Map()),
      );

      expect(rows[0]).toMatchObject({
        impressions: null,
        reactions: null,
        clicks: null,
        engagementRate: null,
      });
    });
  });

  describe('buildOrganizationAudience', () => {
    it('should make 2 calls and build the facets', async () => {
      api.organizationNetworkSize.mockResolvedValue({ firstDegreeSize: 40 });
      api.organizationFollowerDemographics.mockResolvedValue([
        {
          followerCountsBySeniority: [
            {
              seniority: 'urn:li:seniority:4',
              followerCounts: { organicFollowerCount: 40 },
            },
          ],
        },
      ]);

      const result = await buildOrganizationAudience(api, ORG);

      expect(result.sections).toHaveLength(2);
      expect(result.totalFollowers).toBe(40);
      expect(result.facets).toEqual([
        {
          key: 'seniority',
          label: 'Seniority',
          items: [{ label: 'Senior', count: 40, share: 100 }],
        },
      ]);
    });

    it('should give no facets when the demographics call fails', async () => {
      api.organizationNetworkSize.mockResolvedValue({ firstDegreeSize: 40 });
      api.organizationFollowerDemographics.mockRejectedValue(
        new ApiError(500, '', {}),
      );

      const result = await buildOrganizationAudience(api, ORG);

      expect(result.totalFollowers).toBe(40);
      expect(result.facets).toEqual([]);
    });
  });
});
