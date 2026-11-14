import type { Metric } from './interfaces';

/** A day's value, or `null` when LinkedIn has not given one. */
export type DailyValue = number | null;

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** `(value - previous) / previous * 100`, one decimal; null on 0 or unknown. */
export function changePct(
  value: number,
  previous: number | null,
): number | null {
  if (previous === null || previous === 0) return null;
  return round1(((value - previous) / previous) * 100);
}

export function toMetric(value: number, previous: number | null): Metric {
  return { value, previous, changePct: changePct(value, previous) };
}

/**
 * Sum of the known days, clamped at 0: an organization's `likeCount` can be
 * negative on a day (unlikes), but a period total never is.
 */
export function sumDaily(values: DailyValue[]): number {
  const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return Math.max(0, total);
}

/**
 * One value per date. A date LinkedIn left out of a successful daily response
 * is `0` (it omits days with no activity), except dates after
 * `notPublishedAfter`, which LinkedIn has not published yet and are `null`.
 */
export function fillDaily(
  dates: string[],
  values: Map<string, number>,
  notPublishedAfter?: string,
): DailyValue[] {
  return dates.map((date) => {
    const value = values.get(date);
    if (value !== undefined) return value;
    if (notPublishedAfter !== undefined && date > notPublishedAfter) {
      return null;
    }
    return 0;
  });
}

/** Splits a double-length daily window into its previous and current halves. */
export function splitHalves<T>(
  values: T[],
  days: number,
): { previous: T[]; current: T[] } {
  return { previous: values.slice(0, days), current: values.slice(days) };
}

export interface EngagementCounts {
  impressions: number | null;
  reactions: number | null;
  comments: number | null;
  reposts?: number | null;
  clicks?: number | null;
}

/**
 * `(reactions + comments + reposts [+ clicks]) / impressions * 100`, unrounded.
 * Absent (`undefined`) counts are left out; a `null` count means it is
 * unknown and so is the rate. `null` when impressions are 0 or unknown.
 */
export function rawEngagementRate(counts: EngagementCounts): number | null {
  const { impressions } = counts;
  if (impressions === null || impressions <= 0) return null;
  const parts = [
    counts.reactions,
    counts.comments,
    counts.reposts,
    counts.clicks,
  ].filter((value) => value !== undefined);
  if (parts.some((value) => value === null)) return null;
  const engaged = (parts as number[]).reduce((sum, value) => sum + value, 0);
  return (engaged / impressions) * 100;
}

export function engagementRate(counts: EngagementCounts): number | null {
  const rate = rawEngagementRate(counts);
  return rate === null ? null : round1(rate);
}

/**
 * The engagement rate as a Metric. Its `changePct` is the relative change
 * between the unrounded rates.
 */
export function engagementRateMetric(
  current: EngagementCounts,
  previous: EngagementCounts,
): Metric | null {
  const value = rawEngagementRate(current);
  if (value === null) return null;
  const before = rawEngagementRate(previous);
  return {
    value: round1(value),
    previous: before === null ? null : round1(before),
    changePct: before === null ? null : changePct(value, before),
  };
}
