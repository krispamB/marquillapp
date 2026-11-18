import { AnalyticsCacheService } from './analytics-cache.service';

const makeService = () => {
  const client = { get: jest.fn(), set: jest.fn() };
  const redisService = { getClient: jest.fn(() => client) };
  const service = new AnalyticsCacheService(redisService as any);
  return { service, mocks: { client } };
};

describe('AnalyticsCacheService', () => {
  let service: AnalyticsCacheService;
  let mocks: ReturnType<typeof makeService>['mocks'];

  beforeEach(() => {
    jest.clearAllMocks();
    ({ service, mocks } = makeService());
  });

  describe('get', () => {
    it('should parse a stored JSON value', async () => {
      mocks.client.get.mockResolvedValue('{"a":1}');
      await expect(service.get('k')).resolves.toEqual({ a: 1 });
    });

    it('should return null on a miss', async () => {
      mocks.client.get.mockResolvedValue(null);
      await expect(service.get('k')).resolves.toBeNull();
    });

    it('should fail open when Redis errors', async () => {
      mocks.client.get.mockRejectedValue(new Error('down'));
      await expect(service.get('k')).resolves.toBeNull();
    });

    it('should fail open when Redis does not answer in time', async () => {
      service.timeoutMs = 5;
      mocks.client.get.mockReturnValue(new Promise(() => undefined));
      await expect(service.get('k')).resolves.toBeNull();
    });
  });

  describe('set', () => {
    it('should store JSON with an expiry', async () => {
      mocks.client.set.mockResolvedValue('OK');
      await service.set('k', { a: 1 }, 60);
      expect(mocks.client.set).toHaveBeenCalledWith('k', '{"a":1}', 'EX', 60);
    });

    it('should skip a zero TTL', async () => {
      await service.set('k', {}, 0);
      expect(mocks.client.set).not.toHaveBeenCalled();
    });

    it('should fail open when Redis errors', async () => {
      mocks.client.set.mockRejectedValue(new Error('down'));
      await expect(service.set('k', {}, 60)).resolves.toBeUndefined();
    });
  });
});
