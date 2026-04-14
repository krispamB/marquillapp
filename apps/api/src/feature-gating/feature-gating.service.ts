import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  SubscriptionStatus,
  Subscription,
  Tier,
  Usage,
} from '../database/schemas';

import {
  FEATURE_GATE_ERROR_CODE,
  FEATURE_KEYS,
  FeatureKey,
} from './feature-gating.constants';
import { FeatureGateForbiddenException } from './feature-gating.exception';

@Injectable()
export class FeatureGatingService {
  constructor(
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<Subscription>,
    @InjectModel(Tier.name) private readonly tierModel: Model<Tier>,
    @InjectModel(Usage.name) private readonly usageModel: Model<Usage>,
    @InjectModel('ConnectedAccount')
    private readonly connectedAccountModel: Model<any>,
  ) {}

  async resolveEntitlementTier(userId: string): Promise<Tier> {
    const entitlement = await this.resolveEntitlement(userId);
    if (!entitlement.tier) {
      throw new NotFoundException('Default tier not configured');
    }
    return entitlement.tier;
  }

  async resolveEntitlement(userId: string): Promise<{
    tier: Tier | null;
    source: 'subscription' | 'default';
    subscriptionStatus: SubscriptionStatus | null;
  }> {
    const subscription = await this.subscriptionModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .sort({ updatedAt: -1 })
      .lean();

    if (
      subscription &&
      (subscription.status === SubscriptionStatus.ACTIVE ||
        subscription.status === SubscriptionStatus.PAST_DUE) &&
      subscription.currentPeriodEnd > new Date()
    ) {
      const paidTier = await this.tierModel
        .findById(subscription.tierId)
        .lean();
      if (paidTier) {
        return {
          tier: paidTier as Tier,
          source: 'subscription',
          subscriptionStatus: subscription.status,
        };
      }
    }

    const defaultTier = await this.tierModel
      .findOne({ isDefault: true, isActive: true })
      .lean();

    return {
      tier: (defaultTier as Tier | null) ?? null,
      source: 'default',
      subscriptionStatus: subscription?.status ?? null,
    };
  }

  getLimitFromTier(tier: Tier, feature: FeatureKey): number {
    const limit = tier?.limits?.[feature];

    if (!Number.isInteger(limit)) {
      throw new InternalServerErrorException(
        `Tier "${tier?.name ?? 'unknown'}" has invalid limit for "${feature}"`,
      );
    }

    return limit;
  }

  async assertAiDraftQuota(userId: string): Promise<void> {
    const tier = await this.resolveEntitlementTier(userId);
    const limit = this.getLimitFromTier(tier, FEATURE_KEYS.AI_DRAFTS);
    const periodStart = await this.resolveUsagePeriodStart(userId);
    const currentUsage = await this.getUsageCount(
      userId,
      FEATURE_KEYS.AI_DRAFTS,
      periodStart,
    );

    if (currentUsage >= limit) {
      throw new FeatureGateForbiddenException({
        code: FEATURE_GATE_ERROR_CODE,
        feature: FEATURE_KEYS.AI_DRAFTS,
        limit,
        currentUsage,
        tier: {
          id: tier._id.toString(),
          name: tier.name,
        },
        upgradeHint: 'Upgrade your plan to create more AI drafts this month.',
      });
    }
  }

  async incrementAiDraftUsage(userId: string): Promise<void> {
    const periodStart = await this.resolveUsagePeriodStart(userId);
    const userObjectId = new Types.ObjectId(userId);

    const query = {
      user_id: userObjectId,
      feature: FEATURE_KEYS.AI_DRAFTS,
      periodStart,
    };

    const update = {
      $inc: { count: 1 },
      $setOnInsert: {
        user_id: userObjectId,
        feature: FEATURE_KEYS.AI_DRAFTS,
        periodStart,
      },
    };

    try {
      await this.usageModel.updateOne(query, update, { upsert: true });
    } catch (error: any) {
      if (error?.code === 11000) {
        await this.usageModel.updateOne(query, { $inc: { count: 1 } });
        return;
      }
      throw error;
    }
  }

  async assertScheduledPostQuota(userId: string): Promise<void> {
    const tier = await this.resolveEntitlementTier(userId);
    const limit = this.getLimitFromTier(tier, FEATURE_KEYS.SCHEDULED_POSTS);
    const periodStart = await this.resolveUsagePeriodStart(userId);
    const currentUsage = await this.getUsageCount(
      userId,
      FEATURE_KEYS.SCHEDULED_POSTS,
      periodStart,
    );

    if (currentUsage >= limit) {
      throw new FeatureGateForbiddenException({
        code: FEATURE_GATE_ERROR_CODE,
        feature: FEATURE_KEYS.SCHEDULED_POSTS,
        limit,
        currentUsage,
        tier: {
          id: tier._id.toString(),
          name: tier.name,
        },
        upgradeHint: 'Upgrade your plan to schedule more posts this month.',
      });
    }
  }

  async incrementScheduledPostUsage(userId: string): Promise<void> {
    const periodStart = await this.resolveUsagePeriodStart(userId);
    const userObjectId = new Types.ObjectId(userId);

    const query = {
      user_id: userObjectId,
      feature: FEATURE_KEYS.SCHEDULED_POSTS,
      periodStart,
    };

    const update = {
      $inc: { count: 1 },
      $setOnInsert: {
        user_id: userObjectId,
        feature: FEATURE_KEYS.SCHEDULED_POSTS,
        periodStart,
      },
    };

    try {
      await this.usageModel.updateOne(query, update, { upsert: true });
    } catch (error: any) {
      if (error?.code === 11000) {
        await this.usageModel.updateOne(query, { $inc: { count: 1 } });
        return;
      }
      throw error;
    }
  }

  async assertConnectedAccountCapacity(params: {
    userId: string;
    isReconnect: boolean;
  }): Promise<void> {
    if (params.isReconnect) {
      return;
    }

    const tier = await this.resolveEntitlementTier(params.userId);
    const limit = this.getLimitFromTier(tier, FEATURE_KEYS.CONNECTED_ACCOUNTS);
    const currentUsage = await this.connectedAccountModel.countDocuments({
      user: new Types.ObjectId(params.userId),
      isActive: true,
    });

    if (currentUsage >= limit) {
      throw new FeatureGateForbiddenException({
        code: FEATURE_GATE_ERROR_CODE,
        feature: FEATURE_KEYS.CONNECTED_ACCOUNTS,
        limit,
        currentUsage,
        tier: {
          id: tier._id.toString(),
          name: tier.name,
        },
        upgradeHint: 'Upgrade your plan to connect more accounts.',
      });
    }
  }

  async assertCompanyPagesAccess(userId: string): Promise<void> {
    const tier = await this.resolveEntitlementTier(userId);
    const limit = this.getLimitFromTier(tier, FEATURE_KEYS.CONNECTED_ACCOUNTS);

    if (limit <= 1) {
      throw new FeatureGateForbiddenException({
        code: FEATURE_GATE_ERROR_CODE,
        feature: FEATURE_KEYS.CONNECTED_ACCOUNTS,
        limit,
        currentUsage: 0,
        tier: {
          id: tier._id.toString(),
          name: tier.name,
        },
        upgradeHint:
          'Upgrade to Pro Writer to connect LinkedIn company pages.',
      });
    }
  }

  async getDashboardUsage(userId: string): Promise<{
    tier: { id: string; name: string };
    billingCycle: {
      start: Date;
      end: Date;
      source: 'subscription' | 'default';
    };
    usage: {
      connected_accounts: { used: number; limit: number; remaining: number };
      ai_drafts: { used: number; limit: number; remaining: number };
      scheduled_posts: { used: number; limit: number; remaining: number };
    };
  }> {
    const entitlement = await this.resolveEntitlement(userId);
    if (!entitlement.tier) {
      throw new NotFoundException('Default tier not configured');
    }

    const tier = entitlement.tier;
    const usagePeriod = await this.resolveUsagePeriod(userId);

    const [connectedAccountsUsed, meteredUsageCounts] = await Promise.all([
      this.connectedAccountModel.countDocuments({
        user: new Types.ObjectId(userId),
        isActive: true,
      }),
      this.getUsageCountsForFeatures(
        userId,
        [FEATURE_KEYS.AI_DRAFTS, FEATURE_KEYS.SCHEDULED_POSTS],
        usagePeriod.periodStart,
      ),
    ]);

    const connectedAccountsLimit = this.getLimitFromTier(
      tier,
      FEATURE_KEYS.CONNECTED_ACCOUNTS,
    );
    const aiDraftsLimit = this.getLimitFromTier(tier, FEATURE_KEYS.AI_DRAFTS);
    const scheduledPostsLimit = this.getLimitFromTier(
      tier,
      FEATURE_KEYS.SCHEDULED_POSTS,
    );

    const aiDraftsUsed = meteredUsageCounts[FEATURE_KEYS.AI_DRAFTS] ?? 0;
    const scheduledPostsUsed =
      meteredUsageCounts[FEATURE_KEYS.SCHEDULED_POSTS] ?? 0;

    return {
      tier: {
        id: tier._id.toString(),
        name: tier.name,
      },
      billingCycle: {
        start: usagePeriod.periodStart,
        end: usagePeriod.periodEnd,
        source: usagePeriod.source,
      },
      usage: {
        connected_accounts: {
          used: connectedAccountsUsed,
          limit: connectedAccountsLimit,
          remaining: this.calculateRemaining(
            connectedAccountsUsed,
            connectedAccountsLimit,
          ),
        },
        ai_drafts: {
          used: aiDraftsUsed,
          limit: aiDraftsLimit,
          remaining: this.calculateRemaining(aiDraftsUsed, aiDraftsLimit),
        },
        scheduled_posts: {
          used: scheduledPostsUsed,
          limit: scheduledPostsLimit,
          remaining: this.calculateRemaining(
            scheduledPostsUsed,
            scheduledPostsLimit,
          ),
        },
      },
    };
  }

  private async getUsageCount(
    userId: string,
    feature: FeatureKey,
    periodStart: Date,
  ): Promise<number> {
    const usage = await this.usageModel
      .findOne({
        user_id: new Types.ObjectId(userId),
        feature,
        periodStart,
      })
      .lean();

    return usage?.count ?? 0;
  }

  private async getUsageCountsForFeatures(
    userId: string,
    features: FeatureKey[],
    periodStart: Date,
  ): Promise<Record<string, number>> {
    const usageRows = await this.usageModel
      .find({
        user_id: new Types.ObjectId(userId),
        feature: { $in: features },
        periodStart,
      })
      .select('feature count')
      .lean();

    const result: Record<string, number> = {};
    for (const feature of features) {
      result[feature] = 0;
    }
    for (const row of usageRows) {
      result[row.feature] = row.count ?? 0;
    }

    return result;
  }

  private async resolveUsagePeriodStart(userId: string): Promise<Date> {
    const usagePeriod = await this.resolveUsagePeriod(userId);
    return usagePeriod.periodStart;
  }

  private async resolveUsagePeriod(userId: string): Promise<{
    periodStart: Date;
    periodEnd: Date;
    source: 'subscription' | 'default';
  }> {
    const subscription = await this.subscriptionModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .sort({ updatedAt: -1 })
      .lean();

    if (
      subscription &&
      (subscription.status === SubscriptionStatus.ACTIVE ||
        subscription.status === SubscriptionStatus.PAST_DUE) &&
      subscription.currentPeriodEnd > new Date()
    ) {
      return {
        periodStart: new Date(subscription.currentPeriodStart),
        periodEnd: new Date(subscription.currentPeriodEnd),
        source: 'subscription',
      };
    }

    const periodStart = this.getCurrentUtcMonthStart();
    return {
      periodStart,
      periodEnd: this.getNextUtcMonthStart(periodStart),
      source: 'default',
    };
  }

  private getCurrentUtcMonthStart(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }

  private getNextUtcMonthStart(currentPeriodStart: Date): Date {
    return new Date(
      Date.UTC(
        currentPeriodStart.getUTCFullYear(),
        currentPeriodStart.getUTCMonth() + 1,
        1,
      ),
    );
  }

  private calculateRemaining(used: number, limit: number): number {
    return Math.max(limit - used, 0);
  }
}
