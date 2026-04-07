import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Types } from 'mongoose';

jest.mock(
  '../database/schemas',
  () => ({
    BillingInterval: {
      MONTHLY: 'monthly',
      YEARLY: 'yearly',
    },
    PaymentProvider: {
      POLAR: 'POLAR',
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
  }),
  { virtual: true },
);

import { PaymentService } from './payment.service';
import { SubscriptionStatus } from '../database/schemas';

describe('PaymentService.cancelSubscription', () => {
  const makeService = () => {
    const userModel = {};
    const tierModel = {};
    const subscriptionModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    const billingCustomerModel = {};
    const polarClient = {
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
      polarClient as any,
      configService as any,
      redisService as any,
      featureGatingService as any,
    );

    return {
      service,
      mocks: {
        subscriptionModel,
        polarClient,
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
      polarSubscriptionId: 'sub_123',
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
      mocks.polarClient.cancelSubscriptionAtPeriodEnd,
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
      polarSubscriptionId: 'sub_123',
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
      mocks.polarClient.cancelSubscriptionAtPeriodEnd,
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

  it('throws when subscription is missing Polar reference', async () => {
    const { service, mocks } = makeService();
    const userId = new Types.ObjectId().toString();
    const subscription = {
      status: SubscriptionStatus.ACTIVE,
      cancelAtPeriodEnd: false,
      polarSubscriptionId: undefined,
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
    const polarClient = {};
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
        ai_drafts: { used: 2, limit: 5, remaining: 3 },
        scheduled_posts: { used: 0, limit: 3, remaining: 3 },
      },
    };
    const featureGatingService = {
      getDashboardUsage: jest.fn().mockResolvedValue(usageSummary),
    };

    const service = new PaymentService(
      userModel as any,
      tierModel as any,
      subscriptionModel as any,
      billingCustomerModel as any,
      polarClient as any,
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
