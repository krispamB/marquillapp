import type { AnalyticsRange, AnalyticsRangeKey } from './interfaces';

const DAY_MS = 24 * 60 * 60 * 1000;

export const RANGE_DAYS: Record<AnalyticsRangeKey, number> = {
  '7d': 7,
  '28d': 28,
  '90d': 90,
};

/** `YYYY-MM-DD` of the UTC day containing `ms`. */
export function toUtcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Epoch ms of UTC midnight at the start of `date` (`YYYY-MM-DD`). */
export function utcMidnightMs(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

export function addDays(date: string, days: number): string {
  return toUtcDate(utcMidnightMs(date) + days * DAY_MS);
}

/** Every date from `start` to `end`, both inclusive, oldest first. */
export function enumerateDates(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let ms = utcMidnightMs(start); ms <= utcMidnightMs(end); ms += DAY_MS) {
    dates.push(toUtcDate(ms));
  }
  return dates;
}

/**
 * The range ending yesterday (UTC), whole days, and the period of the same
 * length immediately before it. Today is never included: LinkedIn's figures
 * for the current day are incomplete.
 */
export function computeRange(
  key: AnalyticsRangeKey,
  now: number = Date.now(),
): AnalyticsRange {
  const days = RANGE_DAYS[key];
  const end = addDays(toUtcDate(now), -1);
  const start = addDays(end, -(days - 1));
  const previousEnd = addDays(start, -1);
  const previousStart = addDays(previousEnd, -(days - 1));
  return { key, days, start, end, previousStart, previousEnd };
}

/** UTC date of today, the day a request is made on. */
export function utcToday(now: number = Date.now()): string {
  return toUtcDate(now);
}

/**
 * The single window that covers the previous period and the range, so one
 * daily call feeds both halves of every comparison. `endExclusive` is the
 * midnight after `range.end`, as LinkedIn's end bounds are exclusive.
 */
export function doubleWindow(range: AnalyticsRange): {
  start: string;
  endExclusive: string;
} {
  return { start: range.previousStart, endExclusive: addDays(range.end, 1) };
}

export function currentWindow(range: AnalyticsRange): {
  start: string;
  endExclusive: string;
} {
  return { start: range.start, endExclusive: addDays(range.end, 1) };
}

export function previousWindow(range: AnalyticsRange): {
  start: string;
  endExclusive: string;
} {
  return {
    start: range.previousStart,
    endExclusive: addDays(range.previousEnd, 1),
  };
}
