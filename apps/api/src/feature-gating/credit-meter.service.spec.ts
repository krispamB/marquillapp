import { Types } from 'mongoose';

jest.mock(
  '../database/schemas',
  () => ({
    SubscriptionStatus: {
      ACTIVE: 'ACTIVE',
      CANCELED: 'CANCELED',
      EXPIRED: 'EXPIRED',
      PAST_DUE: 'PAST_DUE',
    },
    Subscription: class Subscription {},
    Tier: class Tier {},
    Usage: class Usage {},
    Artifact: class Artifact {},
    ArtifactType: { POST: 'POST', POLL: 'POLL', DOCUMENT: 'DOCUMENT' },
  }),
  { virtual: true },
);

import { CreditMeterService } from './credit-meter.service';

describe('CreditMeterService', () => {
  const envValues: Record<string, unknown> = {
    CREDITS_PER_USD: 1000,
    CREDIT_MARKUP: 2.0,
    FALLBACK_CREDITS_PER_1K_TOKENS: 10,
    CREDIT_SURCHARGE_WEB_SEARCH: 32,
    CREDIT_SURCHARGE_PDF_RENDER: 4,
    CREDIT_MINIMUM_PDF_RENDER: 8,
  };

  const makeService = (overrides: Record<string, unknown> = {}) => {
    const env = { ...envValues, ...overrides };
    const configService = { get: jest.fn((key: string) => env[key]) };
    const featureGatingService = {
      assertBalance: jest.fn().mockResolvedValue(undefined),
      debit: jest.fn().mockResolvedValue(undefined),
    };

    const service = new CreditMeterService(
      configService as any,
      featureGatingService as any,
    );

    const warn = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation();

    const fixtures = { userId: new Types.ObjectId().toString() };

    return {
      service,
      mocks: { configService, featureGatingService, warn },
      fixtures,
    };
  };

  let service: CreditMeterService;
  let mocks: ReturnType<typeof makeService>['mocks'];
  let fixtures: ReturnType<typeof makeService>['fixtures'];

  beforeEach(() => {
    jest.clearAllMocks();
    ({ service, mocks, fixtures } = makeService());
  });

  describe('toCredits', () => {
    it('should price an llm call from provider cost when cost is present', () => {
      // $0.0234 * 1000 credits/USD * 2.0 markup = 46.8 -> 47
      expect(service.toCredits({ kind: 'llm', amount: 0.0234 })).toBe(47);
    });

    it('should round llm credits up to the next whole credit', () => {
      expect(service.toCredits({ kind: 'llm', amount: 0.0011 })).toBe(3);
    });

    it('should return an exact integer when cost lands on a credit boundary', () => {
      expect(service.toCredits({ kind: 'llm', amount: 0.05 })).toBe(100);
    });

    it('should apply the markup multiplier to llm cost', () => {
      const { service: marked } = makeService({ CREDIT_MARKUP: 2.5 });

      // 0.01 * 1000 * 2.5 = 25
      expect(marked.toCredits({ kind: 'llm', amount: 0.01 })).toBe(25);
    });

    it('should honour a non-default credit peg', () => {
      const { service: pegged } = makeService({ CREDITS_PER_USD: 100 });

      expect(pegged.toCredits({ kind: 'llm', amount: 0.05 })).toBe(10);
    });

    it('should fall back to token pricing when cost is zero', () => {
      // 2500 / 1000 * 10 = 25
      const credits = service.toCredits({
        kind: 'llm',
        amount: 0,
        detail: { totalTokens: 2500 },
      });

      expect(credits).toBe(25);
    });

    it('should fall back to token pricing when cost is undefined', () => {
      const credits = service.toCredits({
        kind: 'llm',
        detail: { totalTokens: 1000 },
      });

      expect(credits).toBe(10);
    });

    it('should round the token fallback up to the next whole credit', () => {
      // 1050 / 1000 * 10 = 10.5 -> 11
      const credits = service.toCredits({
        kind: 'llm',
        amount: 0,
        detail: { totalTokens: 1050 },
      });

      expect(credits).toBe(11);
    });

    it('should log a warning when the token fallback fires', () => {
      service.toCredits({
        kind: 'llm',
        amount: 0,
        detail: { totalTokens: 2500 },
      });

      expect(mocks.warn).toHaveBeenCalledTimes(1);
    });

    it('should not warn when llm cost is present', () => {
      service.toCredits({ kind: 'llm', amount: 0.01 });

      expect(mocks.warn).not.toHaveBeenCalled();
    });

    it('should charge zero and warn when cost and tokens are both missing', () => {
      expect(service.toCredits({ kind: 'llm', amount: 0 })).toBe(0);
      expect(mocks.warn).toHaveBeenCalledTimes(1);
    });

    it('should charge the flat surcharge per web search call', () => {
      expect(service.toCredits({ kind: 'web_search', amount: 1 })).toBe(32);
    });

    it('should multiply the web search surcharge by the call count', () => {
      expect(service.toCredits({ kind: 'web_search', amount: 3 })).toBe(96);
    });

    it('should charge the eight-credit minimum for one Browserless unit', () => {
      expect(service.toCredits({ kind: 'pdf_render', amount: 1 })).toBe(8);
    });

    it('should charge the eight-credit minimum for two Browserless units', () => {
      expect(service.toCredits({ kind: 'pdf_render', amount: 2 })).toBe(8);
    });

    it('should charge four credits per Browserless unit above the minimum envelope', () => {
      expect(service.toCredits({ kind: 'pdf_render', amount: 3 })).toBe(12);
    });

    it('should ignore markup for surcharge kinds', () => {
      const { service: marked } = makeService({ CREDIT_MARKUP: 2.5 });

      expect(marked.toCredits({ kind: 'web_search', amount: 1 })).toBe(32);
    });

    it('should never return a negative credit amount', () => {
      expect(service.toCredits({ kind: 'llm', amount: -0.5 })).toBe(0);
      expect(service.toCredits({ kind: 'web_search', amount: -1 })).toBe(0);
    });

    it('should charge zero for a zero-count surcharge', () => {
      expect(service.toCredits({ kind: 'pdf_render', amount: 0 })).toBe(0);
    });

    it('should fall back to config defaults when env is unset', () => {
      const { service: bare } = makeService({
        CREDITS_PER_USD: undefined,
        CREDIT_MARKUP: undefined,
        CREDIT_SURCHARGE_WEB_SEARCH: undefined,
      });

      expect(bare.toCredits({ kind: 'llm', amount: 0.01 })).toBe(20);
      expect(bare.toCredits({ kind: 'web_search', amount: 1 })).toBe(32);
    });
  });

  describe('assertBalance', () => {
    it('should delegate the headroom check to the feature gating service', async () => {
      await expect(
        service.assertBalance(fixtures.userId),
      ).resolves.toBeUndefined();

      expect(mocks.featureGatingService.assertBalance).toHaveBeenCalledWith(
        fixtures.userId,
      );
    });

    it('should propagate the gate rejection when the user is out of credits', async () => {
      mocks.featureGatingService.assertBalance.mockRejectedValue(
        new Error('FEATURE_LIMIT_EXCEEDED'),
      );

      await expect(service.assertBalance(fixtures.userId)).rejects.toThrow(
        'FEATURE_LIMIT_EXCEEDED',
      );
    });
  });

  describe('debit', () => {
    it('should delegate the period write to the feature gating service', async () => {
      await service.debit(fixtures.userId, 42);

      expect(mocks.featureGatingService.debit).toHaveBeenCalledWith(
        fixtures.userId,
        42,
      );
    });
  });
});
