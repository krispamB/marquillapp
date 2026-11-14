import { settleSections, type Section } from './analytics-access';
import {
  engagementRate,
  engagementRateMetric,
  toMetric,
} from './analytics-metrics';
import {
  currentWindow,
  doubleWindow,
  enumerateDates,
  previousWindow,
} from './analytics-range';
import type {
  AnalyticsPostRow,
  AnalyticsRange,
  OverviewUnavailableKey,
} from './interfaces';
import type { LinkedinAnalyticsApi } from './linkedin-analytics.client';
import type { MemberPostAnalyticsElement } from './linkedin-analytics.types';
import {
  memberFollowerGainsByDate,
  memberFollowersTotal,
  memberPostCountsByDate,
  memberPostTotal,
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

/**
 * A member's overview: 8 LinkedIn calls, all concurrent.
 * - followers total: `memberFollowersCount?q=me`
 * - follower gains: `memberFollowersCount?q=dateRange`, one double window
 * - impressions, reactions, comments, reposts: `memberCreatorPostAnalytics`
 *   DAILY, one double window each
 * - members reached: `memberCreatorPostAnalytics` TOTAL, current and previous
 *   (MEMBERS_REACHED has no DAILY aggregation)
 */
export async function buildPersonOverview(
  api: LinkedinAnalyticsApi,
  range: AnalyticsRange,
): Promise<BuiltOverview> {
  const window = doubleWindow(range);
  const dates = enumerateDates(window.start, range.end);

  const s = await settleSections({
    followersTotal: api.memberFollowersTotal(),
    followersDaily: api.memberFollowersDaily(window),
    impressions: api.memberPostAnalytics('IMPRESSION', 'DAILY', window),
    reactions: api.memberPostAnalytics('REACTION', 'DAILY', window),
    comments: api.memberPostAnalytics('COMMENT', 'DAILY', window),
    reposts: api.memberPostAnalytics('RESHARE', 'DAILY', window),
    reachedCurrent: api.memberPostAnalytics(
      'MEMBERS_REACHED',
      'TOTAL',
      currentWindow(range),
    ),
    reachedPrevious: api.memberPostAnalytics(
      'MEMBERS_REACHED',
      'TOTAL',
      previousWindow(range),
    ),
  });

  const unavailable: OverviewUnavailableKey[] = [];
  const daily = (
    section: Section<MemberPostAnalyticsElement[]>,
  ): DailyHalves | null =>
    section.ok
      ? dailyHalves(dates, range.days, memberPostCountsByDate(section.value))
      : null;

  const impressions = daily(s.impressions);
  const reactions = daily(s.reactions);
  const comments = daily(s.comments);
  const reposts = daily(s.reposts);
  const gains = s.followersDaily.ok
    ? dailyHalves(
        dates,
        range.days,
        memberFollowerGainsByDate(s.followersDaily.value),
      )
    : null;

  const metrics = emptyMetrics();
  for (const [key, halves] of [
    ['impressions', impressions],
    ['reactions', reactions],
    ['comments', comments],
    ['reposts', reposts],
  ] as const) {
    if (halves) metrics[key] = metricFromHalves(halves);
    else unavailable.push(key);
  }

  if (s.reachedCurrent.ok) {
    metrics.membersReached = toMetric(
      memberPostTotal(s.reachedCurrent.value),
      s.reachedPrevious.ok ? memberPostTotal(s.reachedPrevious.value) : null,
    );
  } else {
    unavailable.push('membersReached');
  }

  if (impressions && reactions && comments && reposts) {
    metrics.engagementRate = engagementRateMetric(
      {
        impressions: currentTotal(impressions),
        reactions: currentTotal(reactions),
        comments: currentTotal(comments),
        reposts: currentTotal(reposts),
      },
      {
        impressions: previousTotal(impressions),
        reactions: previousTotal(reactions),
        comments: previousTotal(comments),
        reposts: previousTotal(reposts),
      },
    );
  } else {
    unavailable.push('engagementRate');
  }

  const total = s.followersTotal.ok
    ? memberFollowersTotal(s.followersTotal.value)
    : null;
  if (total === null) unavailable.push('followers.total');
  if (!gains) unavailable.push('followers.gained');

  const currentDates = dates.slice(range.days);
  const series = currentDates.map((date, index) => ({
    date,
    impressions: seriesValue(impressions, index),
    reactions: seriesValue(reactions, index),
    comments: seriesValue(comments, index),
    reposts: seriesValue(reposts, index),
    followersGained: seriesValue(gains, index),
    clicks: null,
    pageViews: null,
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

/** A Marquill-published post to report on, newest first. */
export interface PersonPostCandidate {
  urn: string;
  postId: string;
  text: string;
  publishedAt: string;
  url: string | null;
}

export const MAX_PERSON_POSTS = 10;

/**
 * Lifetime figures for each post: 3 calls per post (IMPRESSION, REACTION,
 * COMMENT, `aggregation=TOTAL`, no date range), all concurrent. A failed call
 * leaves that figure `null` on that row.
 */
export async function buildPersonPosts(
  api: LinkedinAnalyticsApi,
  candidates: PersonPostCandidate[],
): Promise<{ rows: AnalyticsPostRow[]; sections: Array<Section<unknown>> }> {
  const settled = await Promise.all(
    candidates.map((candidate) =>
      settleSections({
        impressions: api.memberPostLifetime(candidate.urn, 'IMPRESSION'),
        reactions: api.memberPostLifetime(candidate.urn, 'REACTION'),
        comments: api.memberPostLifetime(candidate.urn, 'COMMENT'),
      }),
    ),
  );

  const total = (section: Section<MemberPostAnalyticsElement[]>) =>
    section.ok ? memberPostTotal(section.value) : null;

  const rows = candidates.map((candidate, index): AnalyticsPostRow => {
    const s = settled[index];
    const impressions = total(s.impressions);
    const reactions = total(s.reactions);
    const comments = total(s.comments);
    return {
      urn: candidate.urn,
      postId: candidate.postId,
      text: candidate.text,
      publishedAt: candidate.publishedAt,
      url: candidate.url,
      impressions,
      reactions,
      comments,
      reposts: null,
      clicks: null,
      engagementRate: engagementRate({ impressions, reactions, comments }),
    };
  });

  return {
    rows: sortByImpressions(rows),
    sections: settled.flatMap((s) => Object.values(s)),
  };
}

/** Highest impressions first; rows whose impressions failed go last. */
export function sortByImpressions(
  rows: AnalyticsPostRow[],
): AnalyticsPostRow[] {
  return [...rows].sort(
    (a, b) =>
      (b.impressions ?? -1) - (a.impressions ?? -1) ||
      b.publishedAt.localeCompare(a.publishedAt),
  );
}
