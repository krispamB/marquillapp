import {
  changePct,
  engagementRate,
  engagementRateMetric,
  fillDaily,
  rawEngagementRate,
  round1,
  splitHalves,
  sumDaily,
  toMetric,
} from './analytics-metrics';

describe('analytics-metrics', () => {
  describe('changePct', () => {
    it('should give the relative change with one decimal', () => {
      expect(changePct(96, 71)).toBe(35.2);
      expect(changePct(58, 61)).toBe(-4.9);
    });

    it('should be null when previous is 0 or unknown', () => {
      expect(changePct(5, 0)).toBeNull();
      expect(changePct(5, null)).toBeNull();
    });
  });

  describe('toMetric', () => {
    it('should carry value, previous and change', () => {
      expect(toMetric(18340, 15102)).toEqual({
        value: 18340,
        previous: 15102,
        changePct: 21.4,
      });
    });
  });

  describe('fillDaily', () => {
    const dates = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'];

    it('should fill a day LinkedIn omitted with 0', () => {
      expect(fillDaily(dates, new Map([['2026-11-02', 4]]))).toEqual([
        0, 4, 0, 0,
      ]);
    });

    it('should leave days after the publish cut-off null unless LinkedIn returned them', () => {
      const values = new Map([
        ['2026-11-01', 1],
        ['2026-11-04', 9],
      ]);
      expect(fillDaily(dates, values, '2026-11-02')).toEqual([1, 0, null, 9]);
    });
  });

  describe('sumDaily', () => {
    it('should ignore unknown days', () => {
      expect(sumDaily([1, null, 2])).toBe(3);
    });

    it('should clamp a negative period total at 0 while keeping daily values', () => {
      const daily = [2, -5];
      expect(sumDaily(daily)).toBe(0);
      expect(daily).toEqual([2, -5]);
    });
  });

  describe('splitHalves', () => {
    it('should split a double window into previous then current', () => {
      expect(splitHalves([1, 2, 3, 4], 2)).toEqual({
        previous: [1, 2],
        current: [3, 4],
      });
    });
  });

  describe('engagementRate', () => {
    it('should divide engaged actions by impressions as a percentage', () => {
      expect(
        engagementRate({
          impressions: 18340,
          reactions: 412,
          comments: 58,
          reposts: 14,
        }),
      ).toBe(2.6);
    });

    it('should include clicks when they are given', () => {
      expect(
        engagementRate({
          impressions: 100,
          reactions: 1,
          comments: 1,
          reposts: 1,
          clicks: 2,
        }),
      ).toBe(5);
    });

    it('should leave out counts that are absent for the account type', () => {
      expect(
        engagementRate({ impressions: 200, reactions: 3, comments: 1 }),
      ).toBe(2);
    });

    it('should be null when impressions are 0 or unknown', () => {
      expect(
        engagementRate({ impressions: 0, reactions: 1, comments: 1 }),
      ).toBeNull();
      expect(
        engagementRate({ impressions: null, reactions: 1, comments: 1 }),
      ).toBeNull();
    });

    it('should be null when a count it needs is unknown', () => {
      expect(
        rawEngagementRate({ impressions: 10, reactions: null, comments: 1 }),
      ).toBeNull();
    });
  });

  describe('engagementRateMetric', () => {
    it('should compare the unrounded rates when both periods have impressions', () => {
      const metric = engagementRateMetric(
        { impressions: 1000, reactions: 26, comments: 0, reposts: 0 },
        { impressions: 1000, reactions: 30, comments: 0, reposts: 0 },
      );
      expect(metric).toEqual({ value: 2.6, previous: 3, changePct: -13.3 });
    });

    it('should have a null previous when the previous period had no impressions', () => {
      expect(
        engagementRateMetric(
          { impressions: 10, reactions: 1, comments: 0, reposts: 0 },
          { impressions: 0, reactions: 0, comments: 0, reposts: 0 },
        ),
      ).toEqual({ value: 10, previous: null, changePct: null });
    });

    it('should be null when the current period had no impressions', () => {
      expect(
        engagementRateMetric(
          { impressions: 0, reactions: 0, comments: 0, reposts: 0 },
          { impressions: 10, reactions: 1, comments: 0, reposts: 0 },
        ),
      ).toBeNull();
    });
  });

  it('should round half away from zero to one decimal', () => {
    expect(round1(2.25)).toBe(2.3);
  });
});
