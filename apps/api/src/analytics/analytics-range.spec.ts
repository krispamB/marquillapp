import {
  addDays,
  computeRange,
  currentWindow,
  doubleWindow,
  enumerateDates,
  previousWindow,
  toUtcDate,
  utcMidnightMs,
  utcToday,
} from './analytics-range';

describe('analytics-range', () => {
  afterEach(() => jest.useRealTimers());

  describe('computeRange', () => {
    it('should end yesterday UTC and match the contract example when the range is 28d', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-11-11T09:12:44.000Z'));

      expect(computeRange('28d')).toEqual({
        key: '28d',
        days: 28,
        start: '2026-10-14',
        end: '2026-11-10',
        previousStart: '2026-09-16',
        previousEnd: '2026-10-13',
      });
    });

    it('should use the UTC day when the local time is just past midnight UTC', () => {
      const now = Date.parse('2026-03-01T00:00:01.000Z');
      expect(computeRange('7d', now)).toEqual({
        key: '7d',
        days: 7,
        start: '2026-02-22',
        end: '2026-02-28',
        previousStart: '2026-02-15',
        previousEnd: '2026-02-21',
      });
    });

    it('should still be yesterday when it is one millisecond before midnight UTC', () => {
      const now = Date.parse('2026-02-28T23:59:59.999Z');
      expect(computeRange('7d', now).end).toBe('2026-02-27');
    });

    it('should cover 90 whole days across a leap day when the range is 90d', () => {
      const range = computeRange('90d', Date.parse('2028-03-15T12:00:00Z'));
      expect(enumerateDates(range.start, range.end)).toHaveLength(90);
      expect(
        enumerateDates(range.previousStart, range.previousEnd),
      ).toHaveLength(90);
      expect(addDays(range.previousEnd, 1)).toBe(range.start);
    });
  });

  describe('windows', () => {
    const range = computeRange('7d', Date.parse('2026-11-11T09:00:00Z'));

    it('should span both periods with an exclusive end when the window is double', () => {
      expect(doubleWindow(range)).toEqual({
        start: '2026-10-28',
        endExclusive: '2026-11-11',
      });
    });

    it('should give each period its own exclusive end', () => {
      expect(currentWindow(range)).toEqual({
        start: '2026-11-04',
        endExclusive: '2026-11-11',
      });
      expect(previousWindow(range)).toEqual({
        start: '2026-10-28',
        endExclusive: '2026-11-04',
      });
    });
  });

  describe('date helpers', () => {
    it('should round-trip a date through UTC midnight', () => {
      expect(utcMidnightMs('2026-01-31')).toBe(Date.UTC(2026, 0, 31));
      expect(toUtcDate(utcMidnightMs('2026-01-31'))).toBe('2026-01-31');
    });

    it('should cross month and year ends when adding days', () => {
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
      expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    });

    it('should list dates inclusively and oldest first', () => {
      expect(enumerateDates('2026-10-30', '2026-11-02')).toEqual([
        '2026-10-30',
        '2026-10-31',
        '2026-11-01',
        '2026-11-02',
      ]);
    });

    it('should give the UTC date of now as today', () => {
      expect(utcToday(Date.parse('2026-11-11T23:30:00Z'))).toBe('2026-11-11');
    });
  });
});
