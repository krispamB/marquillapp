import { InternalServerErrorException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SubscriptionStatus } from '../database/schemas/subscription.schema';
import { FeatureGatingService } from './feature-gating.service';

describe('FeatureGatingService', () => {
  const makeService = () => {
    const subscriptionModel = {
      findOne: jest.fn(),
    };
    const tierModel = {
      findById: jest.fn(),
      findOne: jest.fn(),
    };
    const usageModel = {
      findOne: jest.fn(),
      updateOne: jest.fn(),
    };
    const connectedAccountModel = {
      countDocuments: jest.fn(),
    };

    const service = new FeatureGatingService(
      subscriptionModel as any,
      tierModel as any,
      usageModel as any,
      connectedAccountModel as any,
    );

    return {
      service,
      mocks: {
        subscriptionModel,
        tierModel,
        usageModel,
        connectedAccountModel,
      },
    };
  };

  it('resolves paid entitlement tier when subscription is active', async () => {
    const { service, mocks } = makeService();
    const userId = new Types.ObjectId().toString();
    const paidTier = {
      _id: new Types.ObjectId(),
      name: 'Pro',
      limits: { ai_drafts: 100, connected_accounts: 10 },
    };
    const subscription = {
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: new Date(Date.now() + 60_000),
      tierId: paidTier._id,
    };

    mocks.subscriptionModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(subscription),
      }),
    });
    mocks.tierModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(paidTier),
    });

    const entitlement = await service.resolveEntitlement(userId);

    expect(entitlement).toEqual({
      tier: paidTier,
      source: 'subscription',
      subscriptionStatus: SubscriptionStatus.ACTIVE,
    });
  });

  it('falls back to default tier when no active paid subscription exists', async () => {
    const { service, mocks } = makeService();
    const userId = new Types.ObjectId().toString();
    const defaultTier = {
      _id: new Types.ObjectId(),
      name: 'Free',
      limits: { ai_drafts: 2, connected_accounts: 1 },
    };

    mocks.subscriptionModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });
    mocks.tierModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(defaultTier),
    });

    const entitlement = await service.resolveEntitlement(userId);

    expect(entitlement).toEqual({
      tier: defaultTier,
      source: 'default',
      subscriptionStatus: null,
    });
  });

  it('throws for invalid or missing limits', () => {
    const { service } = makeService();
    const tier = {
      _id: new Types.ObjectId(),
      name: 'Broken',
      limits: { ai_drafts: -1 },
    } as any;

    expect(() => service.getLimitFromTier(tier, 'ai_drafts')).toThrow(
      InternalServerErrorException,
    );
  });

  it('blocks AI draft creation when usage reaches the plan limit', async () => {
    const { service, mocks } = makeService();
    const userId = new Types.ObjectId().toString();
    const periodStart = new Date('2026-03-01T00:00:00.000Z');
    const tier = {
      _id: new Types.ObjectId(),
      name: 'Starter',
      limits: { ai_drafts: 10, connected_accounts: 1 },
    } as any;

    jest.spyOn(service, 'resolveEntitlementTier').mockResolvedValue(tier);
    jest
      .spyOn<any, any>(service as any, 'resolveUsagePeriodStart')
      .mockResolvedValue(periodStart);
    mocks.usageModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ count: 10 }),
    });

    await expect(service.assertAiDraftQuota(userId)).rejects.toMatchObject({
      response: {
        code: 'FEATURE_LIMIT_EXCEEDED',
        feature: 'ai_drafts',
        limit: 10,
        currentUsage: 10,
      },
      status: 403,
    });
  });

  it('uses active subscription period start for metered usage', async () => {
    const { service, mocks } = makeService();
    const userId = new Types.ObjectId().toString();
    const currentPeriodStart = new Date('2026-03-14T10:00:00.000Z');

    mocks.subscriptionModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart,
          currentPeriodEnd: new Date(Date.now() + 60_000),
        }),
      }),
    });

    const periodStart = await (service as any).resolveUsagePeriodStart(userId);
    expect(periodStart).toEqual(currentPeriodStart);
  });

  it('falls back to UTC month start for free/default users', async () => {
    const { service, mocks } = makeService();
    const userId = new Types.ObjectId().toString();
    const now = new Date('2026-03-14T10:20:00.000Z');

    jest.useFakeTimers().setSystemTime(now);
    mocks.subscriptionModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });

    const periodStart = await (service as any).resolveUsagePeriodStart(userId);
    expect(periodStart).toEqual(new Date('2026-03-01T00:00:00.000Z'));
    jest.useRealTimers();
  });

  it('increments ai_drafts usage with upsert', async () => {
    const { service, mocks } = makeService();
    const userId = new Types.ObjectId().toString();
    const periodStart = new Date('2026-03-01T00:00:00.000Z');

    jest
      .spyOn<any, any>(service as any, 'resolveUsagePeriodStart')
      .mockResolvedValue(periodStart);
    mocks.usageModel.updateOne.mockResolvedValue({ acknowledged: true });

    await service.incrementAiDraftUsage(userId);

    expect(mocks.usageModel.updateOne).toHaveBeenCalledWith(
      {
        user_id: new Types.ObjectId(userId),
        feature: 'ai_drafts',
        periodStart,
      },
      {
        $inc: { count: 1 },
        $setOnInsert: {
          user_id: new Types.ObjectId(userId),
          feature: 'ai_drafts',
          periodStart,
        },
      },
      { upsert: true },
    );
  });

  it('skips connected account limit check for reconnect flow', async () => {
    const { service, mocks } = makeService();
    const userId = new Types.ObjectId().toString();
    const resolveSpy = jest.spyOn(service, 'resolveEntitlementTier');

    await service.assertConnectedAccountCapacity({
      userId,
      isReconnect: true,
    });

    expect(resolveSpy).not.toHaveBeenCalled();
    expect(mocks.connectedAccountModel.countDocuments).not.toHaveBeenCalled();
  });
});
