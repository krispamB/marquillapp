import type { LinkedinAnalyticsApi } from './linkedin-analytics.client';

export type FakeLinkedinApi = {
  [K in keyof LinkedinAnalyticsApi]: jest.Mock;
};

/** Test double for `LinkedinAnalyticsApi`; every call resolves empty by default. */
export function fakeLinkedinApi(): FakeLinkedinApi {
  const empty = () => jest.fn().mockResolvedValue([]);
  return {
    memberFollowersTotal: empty(),
    memberFollowersDaily: empty(),
    memberPostAnalytics: empty(),
    memberPostLifetime: empty(),
    organizationNetworkSize: jest.fn().mockResolvedValue({}),
    organizationFollowerGains: empty(),
    organizationFollowerDemographics: empty(),
    organizationShareStatsDaily: empty(),
    organizationPageStatsDaily: empty(),
    organizationPosts: empty(),
    organizationPostStats: empty(),
  };
}

export function memberDay(date: string, count: number) {
  const [year, month, day] = date.split('-').map(Number);
  return { count, dateRange: { start: { year, month, day } } };
}

export function timeRangeOf(date: string) {
  return { start: Date.parse(`${date}T00:00:00Z`) };
}
