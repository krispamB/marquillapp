import { ApiError } from '../common/HelperFn/apiFetch.helper';
import {
  DEFAULT_LINKEDIN_ANALYTICS_API_VERSION,
  LinkedinAnalyticsClient,
} from './linkedin-analytics.client';

const makeService = (env: Record<string, string | undefined> = {}) => {
  const configService = { get: jest.fn((key: string) => env[key]) };
  const fetcher = jest.fn();
  const service = new LinkedinAnalyticsClient(configService as any);
  service.fetcher = fetcher as unknown as LinkedinAnalyticsClient['fetcher'];
  service.retryDelayMs = 0;
  return { service, mocks: { fetcher } };
};

const window = { start: '2026-11-01', endExclusive: '2026-11-03' };
const ms = (date: string) => Date.parse(`${date}T00:00:00Z`);

describe('LinkedinAnalyticsClient', () => {
  let service: LinkedinAnalyticsClient;
  let mocks: ReturnType<typeof makeService>['mocks'];

  beforeEach(() => {
    ({ service, mocks } = makeService());
    mocks.fetcher.mockResolvedValue({ data: { elements: [] } });
  });

  const lastCall = () =>
    mocks.fetcher.mock.calls.at(-1) as [string, RequestInit];
  const lastUrl = () => lastCall()[0];
  const lastInit = () => lastCall()[1];

  describe('session', () => {
    it('should send the token, Rest.li and version headers and a timeout signal', async () => {
      await service.session('tok').memberFollowersTotal();

      expect(lastUrl()).toBe(
        'https://api.linkedin.com/rest/memberFollowersCount?q=me',
      );
      expect(lastInit().headers).toEqual({
        Authorization: 'Bearer tok',
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': DEFAULT_LINKEDIN_ANALYTICS_API_VERSION,
      });
      expect(lastInit().signal).toBeInstanceOf(AbortSignal);
    });

    it('should use LINKEDIN_ANALYTICS_API_VERSION when it is set', async () => {
      ({ service, mocks } = makeService({
        LINKEDIN_ANALYTICS_API_VERSION: '202611',
      }));
      mocks.fetcher.mockResolvedValue({ data: {} });
      await service.session('tok').memberFollowersTotal();
      expect(
        (lastInit().headers as Record<string, string>)['LinkedIn-Version'],
      ).toBe('202611');
    });

    it('should return the elements and an empty list when there are none', async () => {
      mocks.fetcher.mockResolvedValueOnce({
        data: { elements: [{ memberFollowersCount: 100 }] },
      });
      await expect(
        service.session('tok').memberFollowersTotal(),
      ).resolves.toEqual([{ memberFollowersCount: 100 }]);
      mocks.fetcher.mockResolvedValueOnce({ data: {} });
      await expect(
        service.session('tok').memberFollowersTotal(),
      ).resolves.toEqual([]);
    });

    it('should build the member follower date-range query unencoded', async () => {
      await service.session('tok').memberFollowersDaily(window);
      expect(lastUrl()).toBe(
        'https://api.linkedin.com/rest/memberFollowersCount?q=dateRange&dateRange=(start:(year:2026,month:11,day:1),end:(year:2026,month:11,day:3))',
      );
    });

    it('should build the member post analytics query', async () => {
      await service
        .session('tok')
        .memberPostAnalytics('IMPRESSION', 'DAILY', window);
      expect(lastUrl()).toBe(
        'https://api.linkedin.com/rest/memberCreatorPostAnalytics?q=me&queryType=IMPRESSION&aggregation=DAILY&dateRange=(start:(year:2026,month:11,day:1),end:(year:2026,month:11,day:3))',
      );
    });

    it('should build the lifetime per-post query with the ugc entity key', async () => {
      await service
        .session('tok')
        .memberPostLifetime('urn:li:ugcPost:9', 'COMMENT');
      expect(lastUrl()).toBe(
        'https://api.linkedin.com/rest/memberCreatorPostAnalytics?q=entity&entity=(ugc:urn%3Ali%3AugcPost%3A9)&queryType=COMMENT&aggregation=TOTAL',
      );
    });

    it('should put the encoded organization URN in the networkSizes path', async () => {
      mocks.fetcher.mockResolvedValueOnce({ data: { firstDegreeSize: 5 } });
      await expect(
        service
          .session('tok')
          .organizationNetworkSize('urn:li:organization:123'),
      ).resolves.toEqual({ firstDegreeSize: 5 });
      expect(lastUrl()).toBe(
        'https://api.linkedin.com/rest/networkSizes/urn%3Ali%3Aorganization%3A123?edgeType=COMPANY_FOLLOWED_BY_MEMBER',
      );
    });

    it('should build daily time intervals for organization statistics', async () => {
      const api = service.session('tok');
      const intervals = `timeIntervals=(timeRange:(start:${ms('2026-11-01')},end:${ms('2026-11-03')}),timeGranularityType:DAY)`;

      await api.organizationFollowerGains('urn:li:organization:1', window);
      expect(lastUrl()).toBe(
        `https://api.linkedin.com/rest/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=urn%3Ali%3Aorganization%3A1&${intervals}`,
      );

      await api.organizationShareStatsDaily('urn:li:organization:1', window);
      expect(lastUrl()).toBe(
        `https://api.linkedin.com/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=urn%3Ali%3Aorganization%3A1&${intervals}`,
      );

      await api.organizationPageStatsDaily('urn:li:organization:1', window);
      expect(lastUrl()).toBe(
        `https://api.linkedin.com/rest/organizationPageStatistics?q=organization&organization=urn%3Ali%3Aorganization%3A1&${intervals}`,
      );
    });

    it('should ask lifetime follower statistics without time intervals', async () => {
      await service
        .session('tok')
        .organizationFollowerDemographics('urn:li:organization:1');
      expect(lastUrl()).toBe(
        'https://api.linkedin.com/rest/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=urn%3Ali%3Aorganization%3A1',
      );
    });

    it('should call the posts finder with the FINDER method header', async () => {
      await service
        .session('tok')
        .organizationPosts('urn:li:organization:1', 50, 50);
      expect(lastUrl()).toBe(
        'https://api.linkedin.com/rest/posts?q=author&author=urn%3Ali%3Aorganization%3A1&count=50&start=50&sortBy=CREATED',
      );
      expect(
        (lastInit().headers as Record<string, string>)['X-RestLi-Method'],
      ).toBe('FINDER');
    });

    it('should list post URNs with List syntax for per-post statistics', async () => {
      await service
        .session('tok')
        .organizationPostStats('urn:li:organization:1', {
          shares: ['urn:li:share:1', 'urn:li:share:2'],
        });
      expect(lastUrl()).toBe(
        'https://api.linkedin.com/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=urn%3Ali%3Aorganization%3A1&shares=List(urn%3Ali%3Ashare%3A1,urn%3Ali%3Ashare%3A2)',
      );
    });

    it('should not retry a 4xx', async () => {
      mocks.fetcher.mockReset();
      mocks.fetcher.mockRejectedValue(new ApiError(429, 'Too Many', {}));
      await expect(
        service.session('tok').memberFollowersTotal(),
      ).rejects.toBeInstanceOf(ApiError);
      expect(mocks.fetcher).toHaveBeenCalledTimes(1);
    });

    it('should retry a 5xx once and succeed', async () => {
      mocks.fetcher.mockReset();
      mocks.fetcher
        .mockRejectedValueOnce(new ApiError(502, 'Bad Gateway', {}))
        .mockResolvedValueOnce({ data: { elements: [{ count: 1 }] } });
      await expect(
        service.session('tok').memberFollowersTotal(),
      ).resolves.toEqual([{ count: 1 }]);
      expect(mocks.fetcher).toHaveBeenCalledTimes(2);
    });

    it('should give up after one retry on network failures', async () => {
      mocks.fetcher.mockReset();
      mocks.fetcher.mockRejectedValue(new TypeError('fetch failed'));
      await expect(
        service.session('tok').memberFollowersTotal(),
      ).rejects.toThrow('fetch failed');
      expect(mocks.fetcher).toHaveBeenCalledTimes(2);
    });
  });
});
