import {
  linkedinDateToUtc,
  memberFollowerGainsByDate,
  memberFollowersTotal,
  memberPostCountsByDate,
  memberPostTotal,
  organizationFollowerGainsByDate,
  organizationPageViewsByDate,
  organizationPostStatsByUrn,
  organizationShareStatsByDate,
  postPublishedMs,
  timeRangeToUtc,
} from './linkedin-normalize';

const day = (date: string) => Date.parse(`${date}T00:00:00Z`);

describe('linkedin-normalize', () => {
  it('should convert LinkedIn date records and time ranges to UTC dates', () => {
    expect(linkedinDateToUtc({ year: 2024, month: 5, day: 4 })).toBe(
      '2024-05-04',
    );
    expect(linkedinDateToUtc(undefined)).toBeNull();
    expect(timeRangeToUtc({ start: day('2026-11-01') })).toBe('2026-11-01');
    expect(timeRangeToUtc(undefined)).toBeNull();
  });

  it('should bucket member follower counts by the start date', () => {
    const map = memberFollowerGainsByDate([
      {
        memberFollowersCount: 3,
        dateRange: {
          start: { year: 2024, month: 5, day: 4 },
          end: { year: 2024, month: 5, day: 5 },
        },
      },
      { memberFollowersCount: 7 },
    ]);
    expect([...map]).toEqual([['2024-05-04', 3]]);
  });

  it('should read the lifetime member follower total, or null when absent', () => {
    expect(memberFollowersTotal([{ memberFollowersCount: 100 }])).toBe(100);
    expect(memberFollowersTotal([])).toBeNull();
  });

  it('should ignore metricType whatever its shape', () => {
    const map = memberPostCountsByDate([
      {
        count: 5,
        metricType: {
          'com.linkedin.adsexternalapi.memberanalytics.v1.CreatorPostAnalyticsMetricTypeV1':
            'IMPRESSION',
        },
        dateRange: { start: { year: 2026, month: 11, day: 1 } },
      },
      {
        count: 2,
        metricType: 'IMPRESSION',
        dateRange: { start: { year: 2026, month: 11, day: 2 } },
      },
    ]);
    expect(map.get('2026-11-01')).toBe(5);
    expect(map.get('2026-11-02')).toBe(2);
  });

  it('should read a TOTAL aggregation as 0 when LinkedIn returns no elements', () => {
    expect(memberPostTotal([])).toBe(0);
    expect(memberPostTotal(undefined)).toBe(0);
    expect(memberPostTotal([{ count: 9120 }])).toBe(9120);
  });

  it('should add organic and paid follower gains', () => {
    const map = organizationFollowerGainsByDate([
      {
        timeRange: { start: day('2026-11-01'), end: day('2026-11-02') },
        followerGains: { organicFollowerGain: 4, paidFollowerGain: 1 },
      },
      { timeRange: { start: day('2026-11-02') } },
    ]);
    expect([...map]).toEqual([['2026-11-01', 5]]);
  });

  it('should read page views from the nested page statistics', () => {
    const map = organizationPageViewsByDate([
      {
        timeRange: { start: day('2026-11-01') },
        totalPageStatistics: { views: { allPageViews: { pageViews: 12 } } },
      },
    ]);
    expect(map.get('2026-11-01')).toBe(12);
  });

  describe('organizationShareStatsByDate', () => {
    it('should map share statistics to contract metrics and keep negative likes', () => {
      const { byDate, uniqueImpressionsMissing } = organizationShareStatsByDate(
        [
          {
            timeRange: { start: day('2026-11-01') },
            totalShareStatistics: {
              impressionCount: 100,
              uniqueImpressionsCount: 80,
              clickCount: 5,
              likeCount: -1,
              commentCount: 2,
              shareCount: 3,
            },
          },
        ],
      );
      expect(byDate.impressions.get('2026-11-01')).toBe(100);
      expect(byDate.uniqueImpressions.get('2026-11-01')).toBe(80);
      expect(byDate.clicks.get('2026-11-01')).toBe(5);
      expect(byDate.reactions.get('2026-11-01')).toBe(-1);
      expect(byDate.comments.get('2026-11-01')).toBe(2);
      expect(byDate.reposts.get('2026-11-01')).toBe(3);
      expect(uniqueImpressionsMissing).toBe(false);
    });

    it('should accept the uniqueImpressionsCounts spelling', () => {
      const { byDate } = organizationShareStatsByDate([
        {
          timeRange: { start: day('2026-11-01') },
          totalShareStatistics: { uniqueImpressionsCounts: 7 },
        },
      ]);
      expect(byDate.uniqueImpressions.get('2026-11-01')).toBe(7);
    });

    it('should flag unique impressions as missing when no element carries them', () => {
      expect(
        organizationShareStatsByDate([
          {
            timeRange: { start: day('2026-11-01') },
            totalShareStatistics: { impressionCount: 1 },
          },
        ]).uniqueImpressionsMissing,
      ).toBe(true);
      expect(organizationShareStatsByDate([]).uniqueImpressionsMissing).toBe(
        false,
      );
    });
  });

  it('should key lifetime post statistics by share or ugcPost URN, clamping negatives', () => {
    const stats = organizationPostStatsByUrn([
      {
        share: 'urn:li:share:1',
        totalShareStatistics: { impressionCount: 10, likeCount: -2 },
      },
      {
        ugcPost: 'urn:li:ugcPost:2',
        totalShareStatistics: {
          impressionCount: 5,
          likeCount: 1,
          commentCount: 1,
          shareCount: 1,
          clickCount: 1,
        },
      },
    ]);
    expect(stats.get('urn:li:share:1')).toEqual({
      impressions: 10,
      reactions: 0,
      comments: 0,
      reposts: 0,
      clicks: 0,
    });
    expect(stats.get('urn:li:ugcPost:2')?.clicks).toBe(1);
  });

  it('should prefer publishedAt over createdAt for a post', () => {
    expect(postPublishedMs({ publishedAt: 2, createdAt: 1 })).toBe(2);
    expect(postPublishedMs({ createdAt: 1 })).toBe(1);
    expect(postPublishedMs({})).toBeNull();
  });
});
