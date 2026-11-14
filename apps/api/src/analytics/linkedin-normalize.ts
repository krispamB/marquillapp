import { toUtcDate } from './analytics-range';
import type {
  LinkedinDate,
  LinkedinPostElement,
  LinkedinTimeRange,
  MemberFollowersCountElement,
  MemberPostAnalyticsElement,
  OrganizationFollowerStatisticsElement,
  OrganizationPageStatisticsElement,
  OrganizationShareStatisticsElement,
  ShareStatistics,
} from './linkedin-analytics.types';

/** Turns LinkedIn responses into per-date maps and plain numbers. */

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function linkedinDateToUtc(
  date: LinkedinDate | undefined,
): string | null {
  if (!date || !date.year || !date.month || !date.day) return null;
  const ms = Date.UTC(date.year, date.month - 1, date.day);
  return Number.isNaN(ms) ? null : toUtcDate(ms);
}

export function timeRangeToUtc(
  range: LinkedinTimeRange | undefined,
): string | null {
  return isFiniteNumber(range?.start) ? toUtcDate(range.start) : null;
}

/** Adds `pick(element)` into the element's date; elements without one are skipped. */
function bucket<T>(
  elements: T[] | undefined,
  dateOf: (element: T) => string | null,
  pick: (element: T) => number | undefined,
): Map<string, number> {
  const values = new Map<string, number>();
  for (const element of elements ?? []) {
    const date = dateOf(element);
    const value = pick(element);
    if (date === null || !isFiniteNumber(value)) continue;
    values.set(date, (values.get(date) ?? 0) + value);
  }
  return values;
}

/**
 * Daily `memberFollowersCount` elements. Each value is read as followers
 * gained that day. TODO: LinkedIn's docs are ambiguous about whether it is the
 * gain or the running total; confirm against real data.
 */
export function memberFollowerGainsByDate(
  elements: MemberFollowersCountElement[] | undefined,
): Map<string, number> {
  return bucket(
    elements,
    (element) => linkedinDateToUtc(element.dateRange?.start),
    (element) => element.memberFollowersCount,
  );
}

export function memberFollowersTotal(
  elements: MemberFollowersCountElement[] | undefined,
): number | null {
  const value = elements?.[0]?.memberFollowersCount;
  return isFiniteNumber(value) ? value : null;
}

export function memberPostCountsByDate(
  elements: MemberPostAnalyticsElement[] | undefined,
): Map<string, number> {
  return bucket(
    elements,
    (element) => linkedinDateToUtc(element.dateRange?.start),
    (element) => element.count,
  );
}

/** An `aggregation=TOTAL` answer; no elements means no activity, so 0. */
export function memberPostTotal(
  elements: MemberPostAnalyticsElement[] | undefined,
): number {
  return (elements ?? []).reduce(
    (sum, element) => sum + (isFiniteNumber(element.count) ? element.count : 0),
    0,
  );
}

export function organizationFollowerGainsByDate(
  elements: OrganizationFollowerStatisticsElement[] | undefined,
): Map<string, number> {
  return bucket(
    elements,
    (element) => timeRangeToUtc(element.timeRange),
    (element) => {
      const gains = element.followerGains;
      if (!gains) return undefined;
      const organic = gains.organicFollowerGain;
      const paid = gains.paidFollowerGain;
      if (!isFiniteNumber(organic) && !isFiniteNumber(paid)) return undefined;
      return (organic ?? 0) + (paid ?? 0);
    },
  );
}

export function organizationPageViewsByDate(
  elements: OrganizationPageStatisticsElement[] | undefined,
): Map<string, number> {
  return bucket(
    elements,
    (element) => timeRangeToUtc(element.timeRange),
    (element) => element.totalPageStatistics?.views?.allPageViews?.pageViews,
  );
}

export type ShareStatKey =
  | 'impressions'
  | 'uniqueImpressions'
  | 'clicks'
  | 'reactions'
  | 'comments'
  | 'reposts';

export function uniqueImpressionsOf(
  stats: ShareStatistics,
): number | undefined {
  return isFiniteNumber(stats.uniqueImpressionsCount)
    ? stats.uniqueImpressionsCount
    : isFiniteNumber(stats.uniqueImpressionsCounts)
      ? stats.uniqueImpressionsCounts
      : undefined;
}

const SHARE_STAT_PICKERS: Record<
  ShareStatKey,
  (stats: ShareStatistics) => number | undefined
> = {
  impressions: (stats) => stats.impressionCount,
  uniqueImpressions: uniqueImpressionsOf,
  clicks: (stats) => stats.clickCount,
  reactions: (stats) => stats.likeCount,
  comments: (stats) => stats.commentCount,
  reposts: (stats) => stats.shareCount,
};

export interface OrganizationShareDaily {
  byDate: Record<ShareStatKey, Map<string, number>>;
  /**
   * LinkedIn returned daily elements but none carried a unique impressions
   * count, so the figure is unknown rather than zero.
   */
  uniqueImpressionsMissing: boolean;
}

export function organizationShareStatsByDate(
  elements: OrganizationShareStatisticsElement[] | undefined,
): OrganizationShareDaily {
  const byDate = {} as Record<ShareStatKey, Map<string, number>>;
  for (const key of Object.keys(SHARE_STAT_PICKERS) as ShareStatKey[]) {
    byDate[key] = bucket(
      elements,
      (element) => timeRangeToUtc(element.timeRange),
      (element) =>
        element.totalShareStatistics
          ? SHARE_STAT_PICKERS[key](element.totalShareStatistics)
          : undefined,
    );
  }
  const withStats = (elements ?? []).filter((e) => e.totalShareStatistics);
  const uniqueImpressionsMissing =
    withStats.length > 0 &&
    withStats.every(
      (element) =>
        uniqueImpressionsOf(element.totalShareStatistics!) === undefined,
    );
  return { byDate, uniqueImpressionsMissing };
}

export interface PostLifetimeStats {
  impressions: number;
  reactions: number;
  comments: number;
  reposts: number;
  clicks: number;
}

/**
 * Lifetime statistics per post URN. A post with no activity is left out by
 * LinkedIn; callers treat a missing URN as zeros.
 */
export function organizationPostStatsByUrn(
  elements: OrganizationShareStatisticsElement[] | undefined,
): Map<string, PostLifetimeStats> {
  const stats = new Map<string, PostLifetimeStats>();
  for (const element of elements ?? []) {
    const urn = element.share ?? element.ugcPost;
    const totals = element.totalShareStatistics;
    if (!urn || !totals) continue;
    const count = (value: number | undefined) =>
      isFiniteNumber(value) ? Math.max(0, value) : 0;
    stats.set(urn, {
      impressions: count(totals.impressionCount),
      reactions: count(totals.likeCount),
      comments: count(totals.commentCount),
      reposts: count(totals.shareCount),
      clicks: count(totals.clickCount),
    });
  }
  return stats;
}

export const ZERO_POST_STATS: PostLifetimeStats = {
  impressions: 0,
  reactions: 0,
  comments: 0,
  reposts: 0,
  clicks: 0,
};

/** The epoch ms a LinkedIn post went live, falling back to its creation. */
export function postPublishedMs(post: LinkedinPostElement): number | null {
  if (isFiniteNumber(post.publishedAt)) return post.publishedAt;
  if (isFiniteNumber(post.createdAt)) return post.createdAt;
  return null;
}
