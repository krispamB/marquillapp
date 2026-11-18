import type { LinkedinAccountType } from '../../database/schemas/connected-account.schema';

/** The response shapes in `docs/api/analytics.md`. */

export const ANALYTICS_RANGE_KEYS = ['7d', '28d', '90d'] as const;
export type AnalyticsRangeKey = (typeof ANALYTICS_RANGE_KEYS)[number];

export type AnalyticsAccess =
  | 'ok'
  | 'reconnect_required'
  | 'missing_scope'
  | 'not_admin'
  | 'unavailable';

export interface AnalyticsRange {
  key: AnalyticsRangeKey;
  days: number;
  /** Inclusive UTC dates, `YYYY-MM-DD`. */
  start: string;
  end: string;
  previousStart: string;
  previousEnd: string;
}

export interface Metric {
  value: number;
  previous: number | null;
  changePct: number | null;
}

export interface AnalyticsAccountSummary {
  id: string;
  accountType: LinkedinAccountType;
  displayName: string;
  avatarUrl: string | null;
}

export type OverviewMetricKey =
  | 'impressions'
  | 'reactions'
  | 'comments'
  | 'reposts'
  | 'engagementRate'
  | 'membersReached'
  | 'uniqueImpressions'
  | 'clicks'
  | 'pageViews';

export type OverviewUnavailableKey =
  | OverviewMetricKey
  | 'followers.total'
  | 'followers.gained';

export interface OverviewSeriesPoint {
  date: string;
  impressions: number | null;
  reactions: number | null;
  comments: number | null;
  reposts: number | null;
  followersGained: number | null;
  clicks: number | null;
  pageViews: number | null;
}

export interface AnalyticsOverview {
  account: AnalyticsAccountSummary;
  access: AnalyticsAccess;
  range: AnalyticsRange;
  fetchedAt: string;
  cached: boolean;
  followers: { total: number | null; gained: Metric | null };
  metrics: Record<OverviewMetricKey, Metric | null>;
  series: OverviewSeriesPoint[];
  unavailable: OverviewUnavailableKey[];
}

export interface AnalyticsPostRow {
  urn: string;
  postId: string | null;
  text: string;
  publishedAt: string;
  url: string | null;
  /** `null` only when that post's LinkedIn call failed. */
  impressions: number | null;
  reactions: number | null;
  comments: number | null;
  reposts: number | null;
  clicks: number | null;
  engagementRate: number | null;
}

export interface AnalyticsPosts {
  access: AnalyticsAccess;
  range: AnalyticsRange;
  fetchedAt: string;
  cached: boolean;
  coverage: 'marquill_posts' | 'all_posts';
  truncated: boolean;
  posts: AnalyticsPostRow[];
}

export type AudienceFacetKey = 'seniority' | 'companySize';

export interface AudienceFacetItem {
  label: string;
  count: number;
  share: number;
}

export interface AudienceFacet {
  key: AudienceFacetKey;
  label: string;
  items: AudienceFacetItem[];
}

export interface AnalyticsAudience {
  access: AnalyticsAccess;
  supported: boolean;
  fetchedAt: string;
  cached: boolean;
  totalFollowers: number | null;
  facets: AudienceFacet[];
}

/** What a builder hands the cache layer: the payload and how to cache it. */
export interface AnalyticsComputation<T> {
  payload: T;
  /**
   * A section failed for a reason that may clear up soon (429, 5xx, network),
   * so a partial `ok` payload is cached only briefly.
   */
  transientFailure: boolean;
}
