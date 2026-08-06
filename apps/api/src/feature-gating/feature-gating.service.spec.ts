import { InternalServerErrorException } from '@nestjs/common';
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

import { SubscriptionStatus } from '../database/schemas';
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
      find: jest.fn(),
      updateOne: jest.fn(),
    };
    const connectedAccountModel = {
      countDocuments: jest.fn(),
    };
    const artifactModel = {
      aggregate: jest.fn().mockResolvedValue([]),
    };

    const service = new FeatureGatingService(
      subscriptionModel as any,
      tierModel as any,
      usageModel as any,
      connectedAccountModel as any,
      artifactModel as any,
    );

    return {
      service,
      mocks: {
        subscriptionModel,
        tierModel,
        usageModel,
        connectedAccountModel,
        artifactModel,
      },
    };
  };

  it('resolves paid entitlement tier when subscription is active', async () => {
    const { service, mocks } = makeService();
    const userId = new Types.ObjectId().toString();
    const paidTier = {
      _id: new Types.ObjectId(),
      name: 'Pro',
      limits: { credits: 100, connected_accounts: 10 },
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
      limits: { credits: 2, connected_accounts: 1 },
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
      limits: {},
    } as any;

    expect(() => service.getLimitFromTier(tier, 'credits')).toThrow(
      InternalServerErrorException,
    );
  });

  describe('assertResearchAccess', () => {
    it('should reject research with the standard feature gate when the tier disables it', async () => {
      const { service } = makeService();
      const tier = {
        _id: new Types.ObjectId(),
        name: 'Free',
        limits: { research: 0 },
      } as any;
      jest.spyOn(service, 'resolveEntitlementTier').mockResolvedValue(tier);

      await expect(
        service.assertResearchAccess(new Types.ObjectId().toString()),
      ).rejects.toMatchObject({
        response: {
          code: 'FEATURE_LIMIT_EXCEEDED',
          feature: 'research',
          limit: 0,
          currentUsage: 0,
        },
        status: 403,
      });
    });

    it('should allow research when the paid tier enables it', async () => {
      const { service } = makeService();
      const tier = {
        _id: new Types.ObjectId(),
        name: 'Starter',
        limits: { research: 1 },
      } as any;
      jest.spyOn(service, 'resolveEntitlementTier').mockResolvedValue(tier);

      await expect(
        service.assertResearchAccess(new Types.ObjectId().toString()),
      ).resolves.toBeUndefined();
    });

    it('should reject research for a persisted legacy Free tier without a research field', async () => {
      const { service } = makeService();
      const tier = {
        _id: new Types.ObjectId(),
        name: 'Free',
        monthlyPrice: 0,
        limits: { credits: 120 },
      } as any;
      jest.spyOn(service, 'resolveEntitlementTier').mockResolvedValue(tier);

      await expect(
        service.assertResearchAccess(new Types.ObjectId().toString()),
      ).rejects.toMatchObject({
        response: { feature: 'research', limit: 0, currentUsage: 0 },
        status: 403,
      });
    });

    it('should allow research for a persisted legacy paid tier without a research field', async () => {
      const { service } = makeService();
      const tier = {
        _id: new Types.ObjectId(),
        name: 'Starter',
        monthlyPrice: 9.99,
        limits: { credits: 2000 },
      } as any;
      jest.spyOn(service, 'resolveEntitlementTier').mockResolvedValue(tier);

      await expect(
        service.assertResearchAccess(new Types.ObjectId().toString()),
      ).resolves.toBeUndefined();
    });
  });

  it('blocks post scheduling when usage reaches the plan limit', async () => {
    const { service, mocks } = makeService();
    const userId = new Types.ObjectId().toString();
    const periodStart = new Date('2026-03-01T00:00:00.000Z');
    const tier = {
      _id: new Types.ObjectId(),
      name: 'Starter',
      limits: { credits: 10, connected_accounts: 1, scheduled_posts: 5 },
    } as any;

    jest.spyOn(service, 'resolveEntitlementTier').mockResolvedValue(tier);
    jest
      .spyOn<any, any>(service as any, 'resolveUsagePeriodStart')
      .mockResolvedValue(periodStart);
    mocks.usageModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ count: 5 }),
    });

    await expect(
      service.assertScheduledPostQuota(userId),
    ).rejects.toMatchObject({
      response: {
        code: 'FEATURE_LIMIT_EXCEEDED',
        feature: 'scheduled_posts',
        limit: 5,
        currentUsage: 5,
      },
      status: 403,
    });
  });

  it('allows post scheduling when usage is below the plan limit', async () => {
    const { service, mocks } = makeService();
    const userId = new Types.ObjectId().toString();
    const periodStart = new Date('2026-03-01T00:00:00.000Z');
    const tier = {
      _id: new Types.ObjectId(),
      name: 'Starter',
      limits: { credits: 10, connected_accounts: 1, scheduled_posts: 5 },
    } as any;

    jest.spyOn(service, 'resolveEntitlementTier').mockResolvedValue(tier);
    jest
      .spyOn<any, any>(service as any, 'resolveUsagePeriodStart')
      .mockResolvedValue(periodStart);
    mocks.usageModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ count: 4 }),
    });

    await expect(
      service.assertScheduledPostQuota(userId),
    ).resolves.toBeUndefined();
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

  it('returns dashboard usage and counts every artifact lifecycle state in the active cycle', async () => {
    const { service, mocks } = makeService();
    const userId = new Types.ObjectId().toString();
    const tierId = new Types.ObjectId();
    const currentPeriodStart = new Date('2026-03-14T00:00:00.000Z');
    const currentPeriodEnd = new Date('2026-04-14T00:00:00.000Z');
    jest.useFakeTimers().setSystemTime(new Date('2026-03-20T00:00:00.000Z'));
    const tier = {
      _id: tierId,
      name: 'Starter',
      limits: {
        credits: 100000,
        connected_accounts: 1,
        scheduled_posts: 3,
      },
    };

    mocks.subscriptionModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest
          .fn()
          .mockResolvedValueOnce({
            status: SubscriptionStatus.ACTIVE,
            currentPeriodStart,
            currentPeriodEnd,
            tierId,
          })
          .mockResolvedValueOnce({
            status: SubscriptionStatus.ACTIVE,
            currentPeriodStart,
            currentPeriodEnd,
          }),
      }),
    });
    mocks.tierModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(tier),
    });
    mocks.connectedAccountModel.countDocuments.mockResolvedValue(1);
    mocks.usageModel.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { feature: 'scheduled_posts', count: 1 },
          { feature: 'credits', count: 5000 },
        ]),
      }),
    });
    mocks.artifactModel.aggregate.mockResolvedValue([
      { _id: 'POST', count: 4 },
      { _id: 'POLL', count: 2 },
      { _id: 'DOCUMENT', count: 1 },
    ]);

    const result = await service.getDashboardUsage(userId);

    expect(result).toEqual({
      tier: { id: tierId.toString(), name: 'Starter' },
      billingCycle: {
        start: currentPeriodStart,
        end: currentPeriodEnd,
        source: 'subscription',
      },
      usage: {
        connected_accounts: { used: 1, limit: 1, remaining: 0 },
        scheduled_posts: { used: 1, limit: 3, remaining: 2 },
        credits: { used: 5000, limit: 100000, remaining: 95000 },
      },
      artifactsCreated: { posts: 4, polls: 2, documents: 1 },
    });
    expect(mocks.artifactModel.aggregate).toHaveBeenCalledWith([
      {
        $match: {
          user: new Types.ObjectId(userId),
          createdAt: { $gte: currentPeriodStart, $lt: currentPeriodEnd },
        },
      },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]);
    const artifactMatch =
      mocks.artifactModel.aggregate.mock.calls[0][0][0].$match;
    expect(artifactMatch).not.toHaveProperty('deletedAt');
    expect(artifactMatch).not.toHaveProperty('versions');
    jest.useRealTimers();
  });

  it('returns default cycle usage summary and floors remaining at zero', async () => {
    const { service, mocks } = makeService();
    const userId = new Types.ObjectId().toString();
    const defaultTierId = new Types.ObjectId();
    const now = new Date('2026-03-20T12:00:00.000Z');

    jest.useFakeTimers().setSystemTime(now);
    mocks.subscriptionModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });
    mocks.tierModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: defaultTierId,
        name: 'Free',
        limits: {
          credits: -1,
          connected_accounts: 1,
          scheduled_posts: 0,
        },
      }),
    });
    mocks.connectedAccountModel.countDocuments.mockResolvedValue(3);
    mocks.usageModel.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ feature: 'credits', count: 7 }]),
      }),
    });

    const result = await service.getDashboardUsage(userId);

    expect(result.billingCycle).toEqual({
      start: new Date('2026-03-01T00:00:00.000Z'),
      end: new Date('2026-04-01T00:00:00.000Z'),
      source: 'default',
    });
    expect(result.usage).toEqual({
      connected_accounts: { used: 3, limit: 1, remaining: 0 },
      scheduled_posts: { used: 0, limit: 0, remaining: 0 },
      credits: { used: 7, limit: -1, remaining: -1 },
    });
    expect(result.artifactsCreated).toEqual({
      posts: 0,
      polls: 0,
      documents: 0,
    });
    jest.useRealTimers();
  });

  describe('getDashboardUsage', () => {
    it('should return the shared Free credit allowance and remaining headroom', async () => {
      const { service, mocks } = makeService();
      const userId = new Types.ObjectId().toString();
      const defaultTierId = new Types.ObjectId();

      mocks.subscriptionModel.findOne.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(null),
        }),
      });
      mocks.tierModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: defaultTierId,
          name: 'Free',
          limits: {
            credits: 120,
            connected_accounts: 1,
            scheduled_posts: 1,
          },
        }),
      });
      mocks.connectedAccountModel.countDocuments.mockResolvedValue(0);
      mocks.usageModel.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest
            .fn()
            .mockResolvedValue([{ feature: 'credits', count: 30 }]),
        }),
      });

      const result = await service.getDashboardUsage(userId);

      expect(result.usage.credits).toEqual({
        used: 30,
        limit: 120,
        remaining: 90,
      });
    });
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

  describe('incrementScheduledPostUsage', () => {
    it('should increment scheduled_posts once when the post has not been counted', async () => {
      const { service, mocks } = makeService();
      const userId = new Types.ObjectId().toString();
      const postId = new Types.ObjectId().toString();
      const periodStart = new Date('2026-03-01T00:00:00.000Z');

      jest
        .spyOn<any, any>(service as any, 'resolveUsagePeriodStart')
        .mockResolvedValue(periodStart);
      mocks.usageModel.updateOne.mockResolvedValue({ acknowledged: true });

      await service.incrementScheduledPostUsage(userId, postId);

      expect(mocks.usageModel.updateOne).toHaveBeenCalledWith(
        {
          user_id: new Types.ObjectId(userId),
          feature: 'scheduled_posts',
          periodStart,
          scheduledPostIds: { $ne: new Types.ObjectId(postId) },
        },
        {
          $inc: { count: 1 },
          $addToSet: { scheduledPostIds: new Types.ObjectId(postId) },
          $setOnInsert: {
            user_id: new Types.ObjectId(userId),
            feature: 'scheduled_posts',
            periodStart,
          },
        },
        { upsert: true },
      );
    });

    it('should keep the conditional post claim when a concurrent upsert races', async () => {
      const { service, mocks } = makeService();
      const userId = new Types.ObjectId().toString();
      const postId = new Types.ObjectId().toString();
      jest
        .spyOn<any, any>(service as any, 'resolveUsagePeriodStart')
        .mockResolvedValue(new Date('2026-03-01T00:00:00.000Z'));
      mocks.usageModel.updateOne
        .mockRejectedValueOnce({ code: 11000 })
        .mockResolvedValueOnce({ modifiedCount: 0 });

      await service.incrementScheduledPostUsage(userId, postId);

      expect(mocks.usageModel.updateOne).toHaveBeenCalledTimes(2);
      expect(mocks.usageModel.updateOne.mock.calls[1][0]).toEqual(
        expect.objectContaining({
          scheduledPostIds: { $ne: new Types.ObjectId(postId) },
        }),
      );
      expect(mocks.usageModel.updateOne.mock.calls[1][1]).toEqual(
        expect.objectContaining({
          $inc: { count: 1 },
          $addToSet: { scheduledPostIds: new Types.ObjectId(postId) },
        }),
      );
    });
  });

  describe('hasScheduledPostUsage', () => {
    it('should find prior scheduling usage when the post was counted in any period', async () => {
      const { service, mocks } = makeService();
      const userId = new Types.ObjectId().toString();
      const postId = new Types.ObjectId().toString();
      mocks.usageModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      });

      await expect(service.hasScheduledPostUsage(userId, postId)).resolves.toBe(
        true,
      );
      expect(mocks.usageModel.findOne).toHaveBeenCalledWith({
        user_id: new Types.ObjectId(userId),
        feature: 'scheduled_posts',
        scheduledPostIds: new Types.ObjectId(postId),
      });
    });
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

  describe('assertBalance', () => {
    const setup = (limit: number, currentUsage: number) => {
      const { service, mocks } = makeService();
      const userId = new Types.ObjectId().toString();
      const tier = {
        _id: new Types.ObjectId(),
        name: 'Starter',
        limits: { credits: limit },
      } as any;
      jest.spyOn(service, 'resolveEntitlementTier').mockResolvedValue(tier);
      jest
        .spyOn<any, any>(service as any, 'resolveUsagePeriodStart')
        .mockResolvedValue(new Date('2026-03-01T00:00:00.000Z'));
      mocks.usageModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ count: currentUsage }),
      });
      return { service, mocks, tier, userId };
    };

    it('should pass when any headroom remains', async () => {
      const { service, userId } = setup(1000, 999);

      await expect(service.assertBalance(userId)).resolves.toBeUndefined();
    });

    it('should pass on a fresh period when nothing is used', async () => {
      const { service, userId } = setup(1000, 0);

      await expect(service.assertBalance(userId)).resolves.toBeUndefined();
    });

    it('should block when usage exactly reaches the limit', async () => {
      const { service, userId } = setup(1000, 1000);

      await expect(service.assertBalance(userId)).rejects.toMatchObject({
        response: {
          code: 'FEATURE_LIMIT_EXCEEDED',
          feature: 'credits',
          limit: 1000,
          currentUsage: 1000,
        },
        status: 403,
      });
    });

    it('should block when a previous run overshot the limit', async () => {
      const { service, userId } = setup(1000, 1060);

      await expect(service.assertBalance(userId)).rejects.toMatchObject({
        response: { feature: 'credits', currentUsage: 1060 },
      });
    });

    it('should pass without reading usage when the limit is -1', async () => {
      const { service, mocks, userId } = setup(-1, 9_999_999);

      await expect(service.assertBalance(userId)).resolves.toBeUndefined();
      expect(mocks.usageModel.findOne).not.toHaveBeenCalled();
    });

    it('should signal plan-not-available when the limit is 0', async () => {
      const { service, userId } = setup(0, 0);

      await expect(service.assertBalance(userId)).rejects.toMatchObject({
        response: {
          feature: 'credits',
          limit: 0,
          upgradeHint: expect.stringContaining('not available'),
        },
      });
    });

    it('should signal an exhausted balance when the limit is positive', async () => {
      const { service, userId } = setup(1000, 1000);

      await expect(service.assertBalance(userId)).rejects.toMatchObject({
        response: {
          upgradeHint: expect.stringContaining('used all your credits'),
        },
      });
    });

    it('should apply a tier upgrade immediately without resetting usage', async () => {
      const { service, mocks, tier, userId } = setup(2000, 2000);

      await expect(service.assertBalance(userId)).rejects.toMatchObject({
        response: { limit: 2000, currentUsage: 2000 },
      });

      tier.name = 'Creator';
      tier.limits.credits = 10000;

      await expect(service.assertBalance(userId)).resolves.toBeUndefined();
      expect(mocks.usageModel.findOne).toHaveBeenCalledTimes(2);
    });
  });

  describe('debit', () => {
    it('should increment credits usage by the settled amount with upsert', async () => {
      const { service, mocks } = makeService();
      const userId = new Types.ObjectId().toString();
      const periodStart = new Date('2026-03-01T00:00:00.000Z');
      jest
        .spyOn<any, any>(service as any, 'resolveUsagePeriodStart')
        .mockResolvedValue(periodStart);
      mocks.usageModel.updateOne.mockResolvedValue({ acknowledged: true });

      await service.debit(userId, 1234);

      expect(mocks.usageModel.updateOne).toHaveBeenCalledWith(
        {
          user_id: new Types.ObjectId(userId),
          feature: 'credits',
          periodStart,
        },
        {
          $inc: { count: 1234 },
          $setOnInsert: {
            user_id: new Types.ObjectId(userId),
            feature: 'credits',
            periodStart,
          },
        },
        { upsert: true },
      );
    });

    it('should retry with a plain increment when the upsert races on E11000', async () => {
      const { service, mocks } = makeService();
      const userId = new Types.ObjectId().toString();
      const periodStart = new Date('2026-03-01T00:00:00.000Z');
      jest
        .spyOn<any, any>(service as any, 'resolveUsagePeriodStart')
        .mockResolvedValue(periodStart);
      mocks.usageModel.updateOne
        .mockRejectedValueOnce({ code: 11000 })
        .mockResolvedValueOnce({ acknowledged: true });

      await service.debit(userId, 50);

      expect(mocks.usageModel.updateOne).toHaveBeenCalledTimes(2);
      expect(mocks.usageModel.updateOne).toHaveBeenLastCalledWith(
        {
          user_id: new Types.ObjectId(userId),
          feature: 'credits',
          periodStart,
        },
        { $inc: { count: 50 } },
      );
    });

    it('should rethrow a write error that is not a duplicate key', async () => {
      const { service, mocks } = makeService();
      const userId = new Types.ObjectId().toString();
      jest
        .spyOn<any, any>(service as any, 'resolveUsagePeriodStart')
        .mockResolvedValue(new Date('2026-03-01T00:00:00.000Z'));
      mocks.usageModel.updateOne.mockRejectedValue(
        new Error('connection lost'),
      );

      await expect(service.debit(userId, 50)).rejects.toThrow(
        'connection lost',
      );
    });

    it('should be a no-op when the amount is zero', async () => {
      const { service, mocks } = makeService();
      const userId = new Types.ObjectId().toString();

      await service.debit(userId, 0);

      expect(mocks.usageModel.updateOne).not.toHaveBeenCalled();
    });

    it('should be a no-op when the amount is negative', async () => {
      const { service, mocks } = makeService();
      const userId = new Types.ObjectId().toString();

      await service.debit(userId, -5);

      expect(mocks.usageModel.updateOne).not.toHaveBeenCalled();
    });
  });
});
