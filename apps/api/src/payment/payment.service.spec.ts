import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Types } from 'mongoose';

// Bun does not hoist jest.mock — use manual module resolution instead
const mockSchemas = {
  BillingInterval: {
    MONTHLY: 'monthly',
    YEARLY: 'yearly',
  },
  PaymentProvider: {
    PADDLE: 'PADDLE',
  },
  SubscriptionStatus: {
    ACTIVE: 'ACTIVE',
    CANCELED: 'CANCELED',
    EXPIRED: 'EXPIRED',
    PAST_DUE: 'PAST_DUE',
  },
  User: class User {},
  Tier: class Tier {},
  Subscription: class Subscription {},
  BillingCustomer: class BillingCustomer {},
  Usage: class Usage {},
  Artifact: class Artifact {},
  ArtifactType: { POST: 'POST', POLL: 'POLL', DOCUMENT: 'DOCUMENT' },
};

jest.mock('../database/schemas', () => mockSchemas, { virtual: true });

import { PaymentService } from './payment.service';
import { SubscriptionStatus } from '../database/schemas';

describe('PaymentService', () => {
  describe('createCheckoutSession', () => {
    const priceId = 'pri_01gm81eqze2vmmvhpjg13bfeqg';

    const makeService = () => {
      const userModel = { findById: jest.fn() };
      const tierModel = { findOne: jest.fn() };
      const subscriptionModel = {};
      const billingCustomerModel = {};
      const paddleClient = { createTransaction: jest.fn() };
      const configService = {};
      const redisService = { getClient: jest.fn() };
      const featureGatingService = { getDashboardUsage: jest.fn() };

      const service = new PaymentService(
        userModel as any,
        tierModel as any,
        subscriptionModel as any,
        billingCustomerModel as any,
        paddleClient as any,
        configService as any,
        redisService as any,
        featureGatingService as any,
      );

      return { service, mocks: { userModel, tierModel, paddleClient } };
    };

    let service: PaymentService;
    let mocks: ReturnType<typeof makeService>['mocks'];

    beforeEach(() => {
      ({ service, mocks } = makeService());
    });

    it('should return a transaction ID when price belongs to an active tier', async () => {
      const userId = new Types.ObjectId();
      const tierId = new Types.ObjectId();
      const user = { _id: userId, name: 'Ada Lovelace' };
      const tier = {
        _id: tierId,
        name: 'Pro',
        isActive: true,
        paddleMonthlyPriceId: priceId,
        paddleYearlyPriceId: 'pri_01gm81eqze2vmmvhpjg13bfeqh',
      };

      mocks.userModel.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue(user),
      });
      mocks.tierModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(tier),
      });
      mocks.paddleClient.createTransaction.mockResolvedValue({
        transactionId: 'txn_01h0j589qt1nee24210teqtz57',
      });

      const result = await service.createCheckoutSession(
        userId.toString(),
        priceId,
      );

      expect(mocks.tierModel.findOne).toHaveBeenCalledWith({
        isActive: true,
        $or: [
          { paddleMonthlyPriceId: priceId },
          { paddleYearlyPriceId: priceId },
        ],
      });
      expect(mocks.paddleClient.createTransaction).toHaveBeenCalledWith({
        priceId,
        userData: { userId: userId.toString(), name: 'Ada Lovelace' },
      });
      expect(result).toEqual({
        transactionId: 'txn_01h0j589qt1nee24210teqtz57',
        tier: { id: tierId.toString(), name: 'Pro' },
        billingInterval: 'monthly',
      });
    });

    it('should throw when the authenticated user does not exist', async () => {
      const userId = new Types.ObjectId();

      mocks.userModel.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });

      await expect(
        service.createCheckoutSession(userId.toString(), priceId),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mocks.paddleClient.createTransaction).not.toHaveBeenCalled();
    });

    it('should reject a price when it does not belong to an active tier', async () => {
      const userId = new Types.ObjectId();

      mocks.userModel.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: userId, name: 'Ada' }),
      });
      mocks.tierModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });

      await expect(
        service.createCheckoutSession(userId.toString(), priceId),
      ).rejects.toThrow('priceId does not belong to an active billing tier');
      expect(mocks.paddleClient.createTransaction).not.toHaveBeenCalled();
    });
  });
});

describe('PaymentService.cancelSubscription', () => {
  const makeService = () => {
    const userModel = {};
    const tierModel = {};
    const subscriptionModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    const billingCustomerModel = {};
    const paddleClient = {
      cancelSubscriptionAtPeriodEnd: jest.fn(),
    };
    const configService = {};
    const redisService = {
      getClient: jest.fn(),
    };
    const featureGatingService = {
      getDashboardUsage: jest.fn(),
    };

    const service = new PaymentService(
      userModel as any,
      tierModel as any,
      subscriptionModel as any,
      billingCustomerModel as any,
      paddleClient as any,
      configService as any,
      redisService as any,
      featureGatingService as any,
    );

    return {
      service,
      mocks: {
        subscriptionModel,
        paddleClient,
        featureGatingService,
      },
    };
  };

  it('cancels active subscription at period end', async () => {
    const { service, mocks } = makeService();
    const userId = new Types.ObjectId().toString();
    const subscription = {
      status: SubscriptionStatus.ACTIVE,
      cancelAtPeriodEnd: false,
      paddleSubscriptionId: 'sub_123',
    };

    mocks.subscriptionModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(subscription),
    });

    const billingSummary = { ok: true };
    jest
      .spyOn(service, 'getBillingSummary')
      .mockResolvedValue(billingSummary as any);

    const result = await service.cancelSubscription(userId);

    expect(
      mocks.paddleClient.cancelSubscriptionAtPeriodEnd,
    ).toHaveBeenCalledWith('sub_123');
    expect(mocks.subscriptionModel.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: expect.any(Types.ObjectId) },
      { cancelAtPeriodEnd: true },
      { new: true },
    );
    expect(result).toBe(billingSummary);
  });

  it('is idempotent when already set to cancel at period end', async () => {
    const { service, mocks } = makeService();
    const userId = new Types.ObjectId().toString();
    const subscription = {
      status: SubscriptionStatus.ACTIVE,
      cancelAtPeriodEnd: true,
      paddleSubscriptionId: 'sub_123',
    };

    mocks.subscriptionModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(subscription),
    });

    const billingSummary = { ok: true };
    jest
      .spyOn(service, 'getBillingSummary')
      .mockResolvedValue(billingSummary as any);

    const result = await service.cancelSubscription(userId);

    expect(
      mocks.paddleClient.cancelSubscriptionAtPeriodEnd,
    ).not.toHaveBeenCalled();
    expect(mocks.subscriptionModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(result).toBe(billingSummary);
  });

  it('throws when subscription is missing', async () => {
    const { service, mocks } = makeService();
    const userId = new Types.ObjectId().toString();

    mocks.subscriptionModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    await expect(service.cancelSubscription(userId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws when subscription is missing Paddle reference', async () => {
    const { service, mocks } = makeService();
    const userId = new Types.ObjectId().toString();
    const subscription = {
      status: SubscriptionStatus.ACTIVE,
      cancelAtPeriodEnd: false,
      paddleSubscriptionId: undefined,
    };

    mocks.subscriptionModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(subscription),
    });

    await expect(service.cancelSubscription(userId)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });
});

describe('PaymentService.getUsageSummary', () => {
  it('returns dashboard usage summary from feature gating service', async () => {
    const userModel = {};
    const tierModel = {};
    const subscriptionModel = {};
    const billingCustomerModel = {};
    const paddleClient = {};
    const configService = {};
    const redisService = {
      getClient: jest.fn(),
    };
    const usageSummary = {
      tier: { id: 'tier-id', name: 'Free' },
      billingCycle: {
        start: new Date('2026-04-01T00:00:00.000Z'),
        end: new Date('2026-05-01T00:00:00.000Z'),
        source: 'default',
      },
      usage: {
        connected_accounts: { used: 1, limit: 1, remaining: 0 },
        scheduled_posts: { used: 0, limit: 3, remaining: 3 },
        credits: { used: 200, limit: 2000, remaining: 1800 },
      },
      artifactsCreated: { posts: 3, polls: 2, documents: 1 },
    };
    const featureGatingService = {
      getDashboardUsage: jest.fn().mockResolvedValue(usageSummary),
    };

    const service = new PaymentService(
      userModel as any,
      tierModel as any,
      subscriptionModel as any,
      billingCustomerModel as any,
      paddleClient as any,
      configService as any,
      redisService as any,
      featureGatingService as any,
    );
    const userId = new Types.ObjectId().toString();

    const result = await service.getUsageSummary(userId);

    expect(featureGatingService.getDashboardUsage).toHaveBeenCalledWith(userId);
    expect(result).toEqual(usageSummary);
  });
});
