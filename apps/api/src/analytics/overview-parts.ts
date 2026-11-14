import {
  fillDaily,
  splitHalves,
  sumDaily,
  toMetric,
  type DailyValue,
} from './analytics-metrics';
import type {
  AnalyticsAccess,
  Metric,
  OverviewMetricKey,
  OverviewSeriesPoint,
  OverviewUnavailableKey,
} from './interfaces';
import type { Section } from './analytics-access';

/** The data part of an overview, before account, access and timing are added. */
export interface OverviewBody {
  followers: { total: number | null; gained: Metric | null };
  metrics: Record<OverviewMetricKey, Metric | null>;
  series: OverviewSeriesPoint[];
  unavailable: OverviewUnavailableKey[];
}

export interface BuiltOverview {
  body: OverviewBody;
  sections: Array<Section<unknown>>;
}

export interface DailyHalves {
  previous: DailyValue[];
  current: DailyValue[];
}

export function emptyMetrics(): Record<OverviewMetricKey, Metric | null> {
  return {
    impressions: null,
    reactions: null,
    comments: null,
    reposts: null,
    engagementRate: null,
    membersReached: null,
    uniqueImpressions: null,
    clicks: null,
    pageViews: null,
  };
}

/** The overview body every non-`ok` response carries. */
export function emptyOverviewBody(): OverviewBody {
  return {
    followers: { total: null, gained: null },
    metrics: emptyMetrics(),
    series: [],
    unavailable: [],
  };
}

export function bodyForAccess(
  access: AnalyticsAccess,
  body: OverviewBody,
): OverviewBody {
  return access === 'ok' ? body : emptyOverviewBody();
}

/**
 * A double-length daily window as zero-filled previous and current halves.
 * `dates` covers both periods, oldest first.
 */
export function dailyHalves(
  dates: string[],
  days: number,
  values: Map<string, number>,
  notPublishedAfter?: string,
): DailyHalves {
  return splitHalves(fillDaily(dates, values, notPublishedAfter), days);
}

export function metricFromHalves(halves: DailyHalves): Metric {
  return toMetric(sumDaily(halves.current), sumDaily(halves.previous));
}

/** Total of the current half, or null when the section failed. */
export function currentTotal(halves: DailyHalves | null): number | null {
  return halves ? sumDaily(halves.current) : null;
}

export function previousTotal(halves: DailyHalves | null): number | null {
  return halves ? sumDaily(halves.previous) : null;
}

/** The value at `index` of the current half, or null when the section failed. */
export function seriesValue(
  halves: DailyHalves | null,
  index: number,
): DailyValue {
  return halves ? (halves.current[index] ?? null) : null;
}
