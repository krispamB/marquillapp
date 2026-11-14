import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiError, apiFetch } from '../common/HelperFn/apiFetch.helper';
import { delay } from '../common/HelperFn/delay.helper';
import type {
  LinkedinElements,
  LinkedinPostElement,
  MemberFollowersCountElement,
  MemberPostAnalyticsElement,
  MemberPostQueryType,
  NetworkSizeResponse,
  OrganizationFollowerStatisticsElement,
  OrganizationPageStatisticsElement,
  OrganizationShareStatisticsElement,
} from './linkedin-analytics.types';
import {
  buildQuery,
  encodeUrn,
  restliDailyTimeIntervals,
  restliDateRange,
  restliPostEntity,
  restliUrnList,
} from './restli';

export const LINKEDIN_REST_BASE = 'https://api.linkedin.com/rest';
export const DEFAULT_LINKEDIN_ANALYTICS_API_VERSION = '202610';
export const LINKEDIN_CALL_TIMEOUT_MS = 10_000;
export const LINKEDIN_RETRY_DELAY_MS = 300;

export interface DateWindow {
  /** Inclusive UTC date. */
  start: string;
  /** Exclusive UTC date: the day after the last one wanted. */
  endExclusive: string;
}

/**
 * The LinkedIn calls analytics makes, bound to one decrypted token. Each
 * method is exactly one HTTP call (plus at most one retry on a 5xx or a
 * network failure); none uses BATCH_GET.
 */
export interface LinkedinAnalyticsApi {
  memberFollowersTotal(): Promise<MemberFollowersCountElement[]>;
  memberFollowersDaily(
    window: DateWindow,
  ): Promise<MemberFollowersCountElement[]>;
  memberPostAnalytics(
    queryType: MemberPostQueryType,
    aggregation: 'DAILY' | 'TOTAL',
    window: DateWindow,
  ): Promise<MemberPostAnalyticsElement[]>;
  memberPostLifetime(
    postUrn: string,
    queryType: MemberPostQueryType,
  ): Promise<MemberPostAnalyticsElement[]>;
  organizationNetworkSize(orgUrn: string): Promise<NetworkSizeResponse>;
  organizationFollowerGains(
    orgUrn: string,
    window: DateWindow,
  ): Promise<OrganizationFollowerStatisticsElement[]>;
  organizationFollowerDemographics(
    orgUrn: string,
  ): Promise<OrganizationFollowerStatisticsElement[]>;
  organizationShareStatsDaily(
    orgUrn: string,
    window: DateWindow,
  ): Promise<OrganizationShareStatisticsElement[]>;
  organizationPageStatsDaily(
    orgUrn: string,
    window: DateWindow,
  ): Promise<OrganizationPageStatisticsElement[]>;
  organizationPosts(
    orgUrn: string,
    start: number,
    count: number,
  ): Promise<LinkedinPostElement[]>;
  organizationPostStats(
    orgUrn: string,
    posts: { shares?: string[]; ugcPosts?: string[] },
  ): Promise<OrganizationShareStatisticsElement[]>;
}

type Fetcher = typeof apiFetch;

/** True for failures worth one retry: 5xx, timeouts and network errors. */
export function isRetryableLinkedinError(error: unknown): boolean {
  if (error instanceof ApiError) return error.statusCode >= 500;
  return true;
}

@Injectable()
export class LinkedinAnalyticsClient {
  private readonly apiVersion: string;
  /** Overridable in tests. */
  fetcher: Fetcher = apiFetch;
  retryDelayMs = LINKEDIN_RETRY_DELAY_MS;
  timeoutMs = LINKEDIN_CALL_TIMEOUT_MS;

  constructor(configService: ConfigService) {
    const configured = configService
      .get<string>('LINKEDIN_ANALYTICS_API_VERSION')
      ?.trim();
    this.apiVersion = configured || DEFAULT_LINKEDIN_ANALYTICS_API_VERSION;
  }

  /** The API for one decrypted access token. */
  session(accessToken: string): LinkedinAnalyticsApi {
    const get = <T>(path: string, extraHeaders?: Record<string, string>) =>
      this.get<T>(accessToken, path, extraHeaders);
    const elements = async <T>(
      path: string,
      extraHeaders?: Record<string, string>,
    ): Promise<T[]> =>
      (await get<LinkedinElements<T>>(path, extraHeaders)).elements ?? [];

    return {
      memberFollowersTotal: () =>
        elements<MemberFollowersCountElement>('/memberFollowersCount?q=me'),
      memberFollowersDaily: (window) =>
        elements<MemberFollowersCountElement>(
          `/memberFollowersCount?${buildQuery([
            ['q', 'dateRange'],
            ['dateRange', restliDateRange(window.start, window.endExclusive)],
          ])}`,
        ),
      memberPostAnalytics: (queryType, aggregation, window) =>
        elements<MemberPostAnalyticsElement>(
          `/memberCreatorPostAnalytics?${buildQuery([
            ['q', 'me'],
            ['queryType', queryType],
            ['aggregation', aggregation],
            ['dateRange', restliDateRange(window.start, window.endExclusive)],
          ])}`,
        ),
      memberPostLifetime: (postUrn, queryType) =>
        elements<MemberPostAnalyticsElement>(
          `/memberCreatorPostAnalytics?${buildQuery([
            ['q', 'entity'],
            ['entity', restliPostEntity(postUrn)],
            ['queryType', queryType],
            ['aggregation', 'TOTAL'],
          ])}`,
        ),
      organizationNetworkSize: (orgUrn) =>
        get<NetworkSizeResponse>(
          `/networkSizes/${encodeUrn(orgUrn)}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`,
        ),
      organizationFollowerGains: (orgUrn, window) =>
        elements<OrganizationFollowerStatisticsElement>(
          `/organizationalEntityFollowerStatistics?${buildQuery([
            ['q', 'organizationalEntity'],
            ['organizationalEntity', encodeUrn(orgUrn)],
            [
              'timeIntervals',
              restliDailyTimeIntervals(window.start, window.endExclusive),
            ],
          ])}`,
        ),
      organizationFollowerDemographics: (orgUrn) =>
        elements<OrganizationFollowerStatisticsElement>(
          `/organizationalEntityFollowerStatistics?${buildQuery([
            ['q', 'organizationalEntity'],
            ['organizationalEntity', encodeUrn(orgUrn)],
          ])}`,
        ),
      organizationShareStatsDaily: (orgUrn, window) =>
        elements<OrganizationShareStatisticsElement>(
          `/organizationalEntityShareStatistics?${buildQuery([
            ['q', 'organizationalEntity'],
            ['organizationalEntity', encodeUrn(orgUrn)],
            [
              'timeIntervals',
              restliDailyTimeIntervals(window.start, window.endExclusive),
            ],
          ])}`,
        ),
      organizationPageStatsDaily: (orgUrn, window) =>
        elements<OrganizationPageStatisticsElement>(
          `/organizationPageStatistics?${buildQuery([
            ['q', 'organization'],
            ['organization', encodeUrn(orgUrn)],
            [
              'timeIntervals',
              restliDailyTimeIntervals(window.start, window.endExclusive),
            ],
          ])}`,
        ),
      organizationPosts: (orgUrn, start, count) =>
        elements<LinkedinPostElement>(
          `/posts?${buildQuery([
            ['q', 'author'],
            ['author', encodeUrn(orgUrn)],
            ['count', count],
            ['start', start > 0 ? start : undefined],
            ['sortBy', 'CREATED'],
          ])}`,
          { 'X-RestLi-Method': 'FINDER' },
        ),
      organizationPostStats: (orgUrn, posts) =>
        elements<OrganizationShareStatisticsElement>(
          `/organizationalEntityShareStatistics?${buildQuery([
            ['q', 'organizationalEntity'],
            ['organizationalEntity', encodeUrn(orgUrn)],
            [
              'shares',
              posts.shares?.length ? restliUrnList(posts.shares) : undefined,
            ],
            [
              'ugcPosts',
              posts.ugcPosts?.length
                ? restliUrnList(posts.ugcPosts)
                : undefined,
            ],
          ])}`,
        ),
    };
  }

  private async get<T>(
    accessToken: string,
    path: string,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    const call = async () => {
      const { data } = await this.fetcher<T>(`${LINKEDIN_REST_BASE}${path}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0',
          'LinkedIn-Version': this.apiVersion,
          ...extraHeaders,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return data;
    };

    try {
      return await call();
    } catch (error) {
      if (!isRetryableLinkedinError(error)) throw error;
      if (this.retryDelayMs > 0) await delay(this.retryDelayMs);
      return call();
    }
  }
}
