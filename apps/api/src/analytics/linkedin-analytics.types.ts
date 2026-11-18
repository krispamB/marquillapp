/** Raw LinkedIn response shapes, only the fields Marquill reads. */

export interface LinkedinDate {
  year: number;
  month: number;
  day: number;
}

export interface LinkedinDateRange {
  start: LinkedinDate;
  end?: LinkedinDate;
}

export interface LinkedinTimeRange {
  start: number;
  end?: number;
}

export interface LinkedinElements<T> {
  elements?: T[];
  paging?: { start?: number; count?: number; total?: number };
}

export interface MemberFollowersCountElement {
  memberFollowersCount?: number;
  dateRange?: LinkedinDateRange;
}

export type MemberPostQueryType =
  | 'IMPRESSION'
  | 'MEMBERS_REACHED'
  | 'RESHARE'
  | 'REACTION'
  | 'COMMENT';

export interface MemberPostAnalyticsElement {
  count?: number;
  /** A string from 202605 on, an object before; never read. */
  metricType?: unknown;
  dateRange?: LinkedinDateRange;
}

export interface NetworkSizeResponse {
  firstDegreeSize?: number;
}

export interface FollowerCounts {
  organicFollowerCount?: number;
  paidFollowerCount?: number;
}

export interface OrganizationFollowerStatisticsElement {
  timeRange?: LinkedinTimeRange;
  followerGains?: {
    organicFollowerGain?: number;
    paidFollowerGain?: number;
  };
  followerCountsBySeniority?: Array<{
    seniority?: string;
    followerCounts?: FollowerCounts;
  }>;
  followerCountsByStaffCountRange?: Array<{
    staffCountRange?: string;
    followerCounts?: FollowerCounts;
  }>;
}

export interface ShareStatistics {
  impressionCount?: number;
  uniqueImpressionsCount?: number;
  /** One LinkedIn sample spells it with a trailing `s`; accept both. */
  uniqueImpressionsCounts?: number;
  clickCount?: number;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
  engagement?: number;
}

export interface OrganizationShareStatisticsElement {
  timeRange?: LinkedinTimeRange;
  share?: string;
  ugcPost?: string;
  totalShareStatistics?: ShareStatistics;
}

export interface OrganizationPageStatisticsElement {
  timeRange?: LinkedinTimeRange;
  totalPageStatistics?: {
    views?: { allPageViews?: { pageViews?: number } };
  };
}

export interface LinkedinPostElement {
  id?: string;
  commentary?: string;
  publishedAt?: number;
  createdAt?: number;
  lifecycleState?: string;
  distribution?: { feedDistribution?: string };
}
