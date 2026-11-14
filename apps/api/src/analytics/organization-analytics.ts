import { settleSections, type Section } from './analytics-access';
import { engagementRate, engagementRateMetric } from './analytics-metrics';
import {
  addDays,
  doubleWindow,
  enumerateDates,
  utcMidnightMs,
} from './analytics-range';
import { buildAudienceFacets } from './audience-facets';
import type {
  AnalyticsPostRow,
  AnalyticsRange,
  AudienceFacet,
  OverviewUnavailableKey,
} from './interfaces';
import type { LinkedinAnalyticsApi } from './linkedin-analytics.client';
import type {
  LinkedinPostElement,
  NetworkSizeResponse,
} from './linkedin-analytics.types';
import { linkedinPostUrl } from '../post/linkedin-post-url';
import { excerpt, littleTextToPlain } from './little-text';
import {
  organizationFollowerGainsByDate,
  organizationPageViewsByDate,
  organizationPostStatsByUrn,
  organizationShareStatsByDate,
  postPublishedMs,
  ZERO_POST_STATS,
  type PostLifetimeStats,
  type ShareStatKey,
} from './linkedin-normalize';
import {
  currentTotal,
  dailyHalves,
  emptyMetrics,
  metricFromHalves,
  previousTotal,
  seriesValue,
  type BuiltOverview,
  type DailyHalves,
} from './overview-parts';
import { isShareUrn, isUgcPostUrn } from './restli';
import { sortByImpressions } from './person-analytics';

/** LinkedIn publishes organization follower gains with a two-day lag. */
export const ORGANIZATION_FOLLOWER_LAG_DAYS = 2;

function networkSizeTotal(response: NetworkSizeResponse): number | null {
  const value = response.firstDegreeSize;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * A page's overview: 4 LinkedIn calls, all concurrent, each over one double
 * window where daily data exists.
 * - followers total: `networkSizes` (`firstDegreeSize`)
 * - follower gains: `organizationalEntityFollowerStatistics`, DAY intervals
 * - impressions, unique impressions, clicks, reactions, comments, reposts:
 *   `organizationalEntityShareStatistics`, DAY intervals
 * - page views: `organizationPageStatistics`, DAY intervals
 */
export async function buildOrganizationOverview(
  api: LinkedinAnalyticsApi,
  orgUrn: string,
  range: AnalyticsRange,
  today: string,
): Promise<BuiltOverview> {
  const window = doubleWindow(range);
  const dates = enumerateDates(window.start, range.end);

  const s = await settleSections({
    followersTotal: api.organizationNetworkSize(orgUrn),
    followerGains: api.organizationFollowerGains(orgUrn, window),
    shares: api.organizationShareStatsDaily(orgUrn, window),
    pages: api.organizationPageStatsDaily(orgUrn, window),
  });

  const unavailable: OverviewUnavailableKey[] = [];
  const metrics = emptyMetrics();

  // Days after today − 2 are not published yet: null, not 0.
  const gains = s.followerGains.ok
    ? dailyHalves(
        dates,
        range.days,
        organizationFollowerGainsByDate(s.followerGains.value),
        addDays(today, -ORGANIZATION_FOLLOWER_LAG_DAYS),
      )
    : null;

  const shareHalves = {} as Record<ShareStatKey, DailyHalves | null>;
  const shareStats = s.shares.ok
    ? organizationShareStatsByDate(s.shares.value)
    : null;
  for (const key of [
    'impressions',
    'uniqueImpressions',
    'clicks',
    'reactions',
    'comments',
    'reposts',
  ] as const) {
    const missing =
      !shareStats ||
      (key === 'uniqueImpressions' && shareStats.uniqueImpressionsMissing);
    shareHalves[key] = missing
      ? null
      : dailyHalves(dates, range.days, shareStats.byDate[key]);
    const halves = shareHalves[key];
    if (halves) metrics[key] = metricFromHalves(halves);
    else unavailable.push(key);
  }

  const pageViews = s.pages.ok
    ? dailyHalves(dates, range.days, organizationPageViewsByDate(s.pages.value))
    : null;
  if (pageViews) metrics.pageViews = metricFromHalves(pageViews);
  else unavailable.push('pageViews');

  if (shareStats) {
    const counts = (pick: (halves: DailyHalves | null) => number | null) => ({
      impressions: pick(shareHalves.impressions),
      reactions: pick(shareHalves.reactions),
      comments: pick(shareHalves.comments),
      reposts: pick(shareHalves.reposts),
      clicks: pick(shareHalves.clicks),
    });
    metrics.engagementRate = engagementRateMetric(
      counts(currentTotal),
      counts(previousTotal),
    );
  } else {
    unavailable.push('engagementRate');
  }

  const total = s.followersTotal.ok
    ? networkSizeTotal(s.followersTotal.value)
    : null;
  if (total === null) unavailable.push('followers.total');
  if (!gains) unavailable.push('followers.gained');

  const currentDates = dates.slice(range.days);
  const series = currentDates.map((date, index) => ({
    date,
    impressions: seriesValue(shareHalves.impressions, index),
    reactions: seriesValue(shareHalves.reactions, index),
    comments: seriesValue(shareHalves.comments, index),
    reposts: seriesValue(shareHalves.reposts, index),
    followersGained: seriesValue(gains, index),
    clicks: seriesValue(shareHalves.clicks, index),
    pageViews: seriesValue(pageViews, index),
  }));

  return {
    body: {
      followers: { total, gained: gains ? metricFromHalves(gains) : null },
      metrics,
      series,
      unavailable,
    },
    sections: Object.values(s),
  };
}

export const ORGANIZATION_POSTS_PAGE_SIZE = 50;
export const ORGANIZATION_POSTS_MAX_PAGES = 2;
export const MAX_ORGANIZATION_POSTS = 50;
export const POST_STATS_URNS_PER_CALL = 20;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

interface QualifiedPost {
  urn: string;
  publishedMs: number;
  text: string;
}

/** Published, main-feed posts whose publish time falls inside the range. */
export function qualifyingPosts(
  elements: LinkedinPostElement[],
  range: AnalyticsRange,
): QualifiedPost[] {
  const startMs = utcMidnightMs(range.start);
  const endMs = utcMidnightMs(addDays(range.end, 1));
  return elements.flatMap((element) => {
    const publishedMs = postPublishedMs(element);
    if (
      !element.id ||
      !(isShareUrn(element.id) || isUgcPostUrn(element.id)) ||
      element.lifecycleState !== 'PUBLISHED' ||
      element.distribution?.feedDistribution !== 'MAIN_FEED' ||
      publishedMs === null ||
      publishedMs < startMs ||
      publishedMs >= endMs
    ) {
      return [];
    }
    return [
      {
        urn: element.id,
        publishedMs,
        text: excerpt(littleTextToPlain(element.commentary ?? '')),
      },
    ];
  });
}

/** True when the oldest post on a full page is still inside the range. */
function pageReachesIntoRange(
  page: LinkedinPostElement[],
  range: AnalyticsRange,
): boolean {
  if (page.length < ORGANIZATION_POSTS_PAGE_SIZE) return false;
  const oldest = page[page.length - 1];
  const oldestMs = oldest.createdAt ?? postPublishedMs(oldest);
  return oldestMs !== null && oldestMs >= utcMidnightMs(range.start);
}

/**
 * Every post on the page published in the range, with lifetime figures.
 * Calls: 1–2 `posts?q=author` pages (newest first, so paging stops once a page
 * passes the range start), then one `organizationalEntityShareStatistics`
 * call per 20 share URNs and per 20 ugcPost URNs.
 */
export async function buildOrganizationPosts(
  api: LinkedinAnalyticsApi,
  orgUrn: string,
  range: AnalyticsRange,
  lookupPostIds: (urns: string[]) => Promise<Map<string, string>>,
): Promise<{
  rows: AnalyticsPostRow[];
  truncated: boolean;
  sections: Array<Section<unknown>>;
}> {
  const sections: Array<Section<unknown>> = [];
  const elements: LinkedinPostElement[] = [];
  let truncated = false;

  for (let page = 0; page < ORGANIZATION_POSTS_MAX_PAGES; page += 1) {
    const { result } = await settleSections({
      result: api.organizationPosts(
        orgUrn,
        page * ORGANIZATION_POSTS_PAGE_SIZE,
        ORGANIZATION_POSTS_PAGE_SIZE,
      ),
    });
    sections.push(result);
    if (!result.ok) {
      // A later page failing leaves the list incomplete, not wrong.
      if (page > 0) truncated = true;
      break;
    }
    elements.push(...result.value);
    if (!pageReachesIntoRange(result.value, range)) break;
    if (page === ORGANIZATION_POSTS_MAX_PAGES - 1) truncated = true;
  }
  if (!sections.some((section) => section.ok)) {
    return { rows: [], truncated: false, sections };
  }

  const seen = new Set<string>();
  const qualified = qualifyingPosts(elements, range)
    .filter((post) => !seen.has(post.urn) && seen.add(post.urn))
    .sort((a, b) => b.publishedMs - a.publishedMs);
  if (qualified.length > MAX_ORGANIZATION_POSTS) truncated = true;
  const kept = qualified.slice(0, MAX_ORGANIZATION_POSTS);
  const urns = kept.map((post) => post.urn);

  const shareChunks = chunk(urns.filter(isShareUrn), POST_STATS_URNS_PER_CALL);
  const ugcChunks = chunk(urns.filter(isUgcPostUrn), POST_STATS_URNS_PER_CALL);
  const statCalls = [
    ...shareChunks.map((shares) => ({
      urns: shares,
      call: api.organizationPostStats(orgUrn, { shares }),
    })),
    ...ugcChunks.map((ugcPosts) => ({
      urns: ugcPosts,
      call: api.organizationPostStats(orgUrn, { ugcPosts }),
    })),
  ];

  const [settledStats, postIds] = await Promise.all([
    Promise.all(
      statCalls.map(async ({ urns: chunkUrns, call }) => ({
        urns: chunkUrns,
        section: (await settleSections({ call })).call,
      })),
    ),
    lookupPostIds(urns).catch(() => new Map<string, string>()),
  ]);

  const stats = new Map<string, PostLifetimeStats | null>();
  for (const { urns: chunkUrns, section } of settledStats) {
    sections.push(section);
    const byUrn = section.ok ? organizationPostStatsByUrn(section.value) : null;
    for (const urn of chunkUrns) {
      // A post LinkedIn left out of a successful answer had no activity.
      stats.set(urn, byUrn ? (byUrn.get(urn) ?? ZERO_POST_STATS) : null);
    }
  }

  const rows = kept.map((post): AnalyticsPostRow => {
    const postStats = stats.get(post.urn) ?? null;
    const value = (key: keyof PostLifetimeStats) =>
      postStats ? postStats[key] : null;
    const counts = {
      impressions: value('impressions'),
      reactions: value('reactions'),
      comments: value('comments'),
      reposts: value('reposts'),
      clicks: value('clicks'),
    };
    return {
      urn: post.urn,
      postId: postIds.get(post.urn) ?? null,
      text: post.text,
      publishedAt: new Date(post.publishedMs).toISOString(),
      url: linkedinPostUrl(post.urn) ?? null,
      ...counts,
      engagementRate: engagementRate(counts),
    };
  });

  return { rows: sortByImpressions(rows), truncated, sections };
}

/**
 * A page's audience: 2 LinkedIn calls, concurrent. `networkSizes` gives the
 * follower total; lifetime `organizationalEntityFollowerStatistics` gives the
 * seniority and company-size facets.
 */
export async function buildOrganizationAudience(
  api: LinkedinAnalyticsApi,
  orgUrn: string,
): Promise<{
  totalFollowers: number | null;
  facets: AudienceFacet[];
  sections: Array<Section<unknown>>;
}> {
  const s = await settleSections({
    total: api.organizationNetworkSize(orgUrn),
    demographics: api.organizationFollowerDemographics(orgUrn),
  });
  return {
    totalFollowers: s.total.ok ? networkSizeTotal(s.total.value) : null,
    facets: s.demographics.ok
      ? buildAudienceFacets(s.demographics.value[0])
      : [],
    sections: Object.values(s),
  };
}
