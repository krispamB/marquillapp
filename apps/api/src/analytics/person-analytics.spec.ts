import { ApiError } from '../common/HelperFn/apiFetch.helper';
import { computeRange } from './analytics-range';
import {
  fakeLinkedinApi,
  memberDay,
  type FakeLinkedinApi,
} from './fake-linkedin-api.mock-spec';
import { buildPersonOverview, buildPersonPosts } from './person-analytics';

// 7d range on 2026-11-11: current 11-04..11-10, previous 10-28..11-03.
const range = computeRange('7d', Date.parse('2026-11-11T09:00:00Z'));

describe('person-analytics', () => {
  let api: FakeLinkedinApi;

  beforeEach(() => {
    api = fakeLinkedinApi();
  });

  describe('buildPersonOverview', () => {
    const byType = (map: Record<string, unknown>) =>
      api.memberPostAnalytics.mockImplementation(
        (type: string, aggregation: string, window: { start: string }) => {
          const key = `${type}:${aggregation}:${window.start}`;
          const value = map[key] ?? map[`${type}:${aggregation}`];
          return value instanceof Error
            ? Promise.reject(value)
            : Promise.resolve(value ?? []);
        },
      );

    it('should make 8 concurrent calls and split one double window into both periods', async () => {
      api.memberFollowersTotal.mockResolvedValue([
        { memberFollowersCount: 4821 },
      ]);
      api.memberFollowersDaily.mockResolvedValue([
        { ...memberDay('2026-10-30', 0), memberFollowersCount: 2 },
        { ...memberDay('2026-11-05', 0), memberFollowersCount: 3 },
      ]);
      byType({
        'IMPRESSION:DAILY': [
          memberDay('2026-10-28', 100),
          memberDay('2026-11-10', 200),
        ],
        'REACTION:DAILY': [memberDay('2026-11-04', 4)],
        'COMMENT:DAILY': [memberDay('2026-11-04', 1)],
        'RESHARE:DAILY': [],
        [`MEMBERS_REACHED:TOTAL:${range.start}`]: [{ count: 90 }],
        [`MEMBERS_REACHED:TOTAL:${range.previousStart}`]: [{ count: 60 }],
      });

      const { body, sections } = await buildPersonOverview(api, range);

      expect(sections).toHaveLength(8);
      expect(api.memberPostAnalytics).toHaveBeenCalledWith(
        'IMPRESSION',
        'DAILY',
        { start: '2026-10-28', endExclusive: '2026-11-11' },
      );
      expect(body.followers).toEqual({
        total: 4821,
        gained: { value: 3, previous: 2, changePct: 50 },
      });
      expect(body.metrics.impressions).toEqual({
        value: 200,
        previous: 100,
        changePct: 100,
      });
      expect(body.metrics.reposts).toEqual({
        value: 0,
        previous: 0,
        changePct: null,
      });
      expect(body.metrics.membersReached).toEqual({
        value: 90,
        previous: 60,
        changePct: 50,
      });
      // Previous: 0 engaged of 100 impressions is a 0% rate, so no change %.
      expect(body.metrics.engagementRate).toEqual({
        value: 2.5,
        previous: 0,
        changePct: null,
      });
      expect(body.metrics.clicks).toBeNull();
      expect(body.metrics.pageViews).toBeNull();
      expect(body.metrics.uniqueImpressions).toBeNull();
      expect(body.unavailable).toEqual([]);

      expect(body.series).toHaveLength(7);
      expect(body.series[0]).toEqual({
        date: '2026-11-04',
        impressions: 0,
        reactions: 4,
        comments: 1,
        reposts: 0,
        followersGained: 0,
        clicks: null,
        pageViews: null,
      });
      expect(body.series[6].date).toBe('2026-11-10');
      expect(body.series[6].impressions).toBe(200);
    });

    it('should null and list a failed section without zeroing it', async () => {
      byType({ 'REACTION:DAILY': new ApiError(503, 'Unavailable', {}) });
      api.memberFollowersTotal.mockRejectedValue(new ApiError(500, '', {}));

      const { body } = await buildPersonOverview(api, range);

      expect(body.metrics.reactions).toBeNull();
      expect(body.metrics.engagementRate).toBeNull();
      expect(body.followers.total).toBeNull();
      expect(body.series.every((point) => point.reactions === null)).toBe(true);
      expect(body.series.every((point) => point.impressions === 0)).toBe(true);
      expect(body.unavailable).toEqual(
        expect.arrayContaining([
          'reactions',
          'engagementRate',
          'followers.total',
        ]),
      );
    });

    it('should keep members reached with a null previous when only the previous call failed', async () => {
      byType({
        [`MEMBERS_REACHED:TOTAL:${range.start}`]: [{ count: 9 }],
        [`MEMBERS_REACHED:TOTAL:${range.previousStart}`]: new TypeError('x'),
      });

      const { body } = await buildPersonOverview(api, range);

      expect(body.metrics.membersReached).toEqual({
        value: 9,
        previous: null,
        changePct: null,
      });
      expect(body.unavailable).not.toContain('membersReached');
    });
  });

  describe('buildPersonPosts', () => {
    const candidate = (n: number) => ({
      urn: `urn:li:share:${n}`,
      postId: `p${n}`,
      text: `post ${n}`,
      publishedAt: `2026-11-0${n}T08:00:00.000Z`,
      url: `https://www.linkedin.com/feed/update/urn:li:share:${n}/`,
    });

    it('should make 3 lifetime calls per post and sort by impressions', async () => {
      api.memberPostLifetime.mockImplementation((urn: string, type: string) => {
        const impressions = urn.endsWith(':1') ? 100 : 500;
        const counts: Record<string, number> = {
          IMPRESSION: impressions,
          REACTION: 10,
          COMMENT: 5,
        };
        return Promise.resolve([{ count: counts[type] }]);
      });

      const { rows, sections } = await buildPersonPosts(api, [
        candidate(1),
        candidate(2),
      ]);

      expect(api.memberPostLifetime).toHaveBeenCalledTimes(6);
      expect(sections).toHaveLength(6);
      expect(rows.map((row) => row.urn)).toEqual([
        'urn:li:share:2',
        'urn:li:share:1',
      ]);
      expect(rows[1]).toEqual({
        ...candidate(1),
        impressions: 100,
        reactions: 10,
        comments: 5,
        reposts: null,
        clicks: null,
        engagementRate: 15,
      });
    });

    it('should leave a failed figure null on its row', async () => {
      api.memberPostLifetime.mockImplementation((_urn: string, type: string) =>
        type === 'COMMENT'
          ? Promise.reject(new ApiError(500, '', {}))
          : Promise.resolve([{ count: 10 }]),
      );

      const { rows } = await buildPersonPosts(api, [candidate(1)]);

      expect(rows[0].comments).toBeNull();
      expect(rows[0].impressions).toBe(10);
      expect(rows[0].engagementRate).toBeNull();
    });

    it('should make no call when there are no posts', async () => {
      const { rows, sections } = await buildPersonPosts(api, []);
      expect(rows).toEqual([]);
      expect(sections).toEqual([]);
      expect(api.memberPostLifetime).not.toHaveBeenCalled();
    });
  });
});
