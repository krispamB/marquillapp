import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Artifact,
  ArtifactType,
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

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 11000;

@Injectable()
export class FeatureGatingService {
  constructor(
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<Subscription>,
    @InjectModel(Tier.name) private readonly tierModel: Model<Tier>,
    @InjectModel(Usage.name) private readonly usageModel: Model<Usage>,
    @InjectModel('ConnectedAccount')
    private readonly connectedAccountModel: Model<any>,
    @InjectModel(Artifact.name)
    private readonly artifactModel: Model<Artifact>,
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

  async assertScheduledPostQuota(userId: string): Promise<void> {
    const tier = await this.resolveEntitlementTier(userId);
    const limit = this.getLimitFromTier(tier, FEATURE_KEYS.SCHEDULED_POSTS);

    if (limit === -1) return; // unlimited

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

  async assertResearchAccess(userId: string): Promise<void> {
    const tier = await this.resolveEntitlementTier(userId);
    const configuredLimit = tier?.limits?.[FEATURE_KEYS.RESEARCH];
    // Deployment-safe bridge for tier documents created before the explicit
    // capability existed. Paid access is inferred from plan price, never from
    // the shared credit balance; the next tier seed upsert persists 0/1.
    const limit =
      configuredLimit === undefined
        ? tier.monthlyPrice > 0
          ? 1
          : 0
        : this.getLimitFromTier(tier, FEATURE_KEYS.RESEARCH);

    if (limit > 0 || limit === -1) return;

    throw new FeatureGateForbiddenException({
      code: FEATURE_GATE_ERROR_CODE,
      feature: FEATURE_KEYS.RESEARCH,
      limit,
      currentUsage: 0,
      tier: {
        id: tier._id.toString(),
        name: tier.name,
      },
      upgradeHint: 'Upgrade your plan to use AI research.',
    });
  }

  async hasScheduledPostUsage(
    userId: string,
    postId: string,
  ): Promise<boolean> {
    const usage = await this.usageModel
      .findOne({
        user_id: new Types.ObjectId(userId),
        feature: FEATURE_KEYS.SCHEDULED_POSTS,
        scheduledPostIds: new Types.ObjectId(postId),
      })
      .lean();
    return usage !== null;
  }

  async incrementScheduledPostUsage(
    userId: string,
    postId: string,
  ): Promise<void> {
    const periodStart = await this.resolveUsagePeriodStart(userId);
    const userObjectId = new Types.ObjectId(userId);
    const postObjectId = new Types.ObjectId(postId);

    const query = {
      user_id: userObjectId,
      feature: FEATURE_KEYS.SCHEDULED_POSTS,
      periodStart,
      scheduledPostIds: { $ne: postObjectId },
    };

    const update = {
      $inc: { count: 1 },
      $addToSet: { scheduledPostIds: postObjectId },
      $setOnInsert: {
        user_id: userObjectId,
        feature: FEATURE_KEYS.SCHEDULED_POSTS,
        periodStart,
      },
    };

    try {
      await this.usageModel.updateOne(query, update, { upsert: true });
    } catch (error: unknown) {
      if (isDuplicateKeyError(error)) {
        await this.usageModel.updateOne(query, update);
        return;
      }
      throw error;
    }
  }

  // Headroom check, not a fit check: commit-on-success has no pre-run estimate to
  // fit against, so a run may start with 5 credits left and settle at 60. The next
  // run's guard catches the overshoot, which the agent's step cap bounds.
  async assertBalance(userId: string): Promise<void> {
    const tier = await this.resolveEntitlementTier(userId);
    const limit = this.getLimitFromTier(tier, FEATURE_KEYS.CREDITS);

    if (limit === -1) return; // unlimited

    const periodStart = await this.resolveUsagePeriodStart(userId);
    const currentUsage = await this.getUsageCount(
      userId,
      FEATURE_KEYS.CREDITS,
      periodStart,
    );

    if (currentUsage < limit) return;

    throw new FeatureGateForbiddenException({
      code: FEATURE_GATE_ERROR_CODE,
      feature: FEATURE_KEYS.CREDITS,
      limit,
      currentUsage,
      tier: {
        id: tier._id.toString(),
        name: tier.name,
      },
      upgradeHint:
        limit === 0
          ? 'AI generation is not available on your plan. Upgrade to start creating.'
          : 'You have used all your credits for this period. Upgrade for more.',
    });
  }

  // Settle a finished run against the period aggregate. The increment is variable,
  // unlike the single-unit capacity counters, so callers pass the resolved total.
  async debit(userId: string, credits: number): Promise<void> {
    if (credits <= 0) return;

    const periodStart = await this.resolveUsagePeriodStart(userId);
    const userObjectId = new Types.ObjectId(userId);

    const query = {
      user_id: userObjectId,
      feature: FEATURE_KEYS.CREDITS,
      periodStart,
    };

    const update = {
      $inc: { count: credits },
      $setOnInsert: {
        user_id: userObjectId,
        feature: FEATURE_KEYS.CREDITS,
        periodStart,
      },
    };

    try {
      await this.usageModel.updateOne(query, update, { upsert: true });
    } catch (error: unknown) {
      if (isDuplicateKeyError(error)) {
        await this.usageModel.updateOne(query, {
          $inc: { count: credits },
        });
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
        upgradeHint: 'Upgrade to Pro Writer to connect LinkedIn company pages.',
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
      scheduled_posts: { used: number; limit: number; remaining: number };
      credits: { used: number; limit: number; remaining: number };
    };
    artifactsCreated: {
      posts: number;
      polls: number;
      documents: number;
    };
  }> {
    const entitlement = await this.resolveEntitlement(userId);
    if (!entitlement.tier) {
      throw new NotFoundException('Default tier not configured');
    }

    const tier = entitlement.tier;
    const usagePeriod = await this.resolveUsagePeriod(userId);

    const [connectedAccountsUsed, meteredUsageCounts, artifactCounts] =
      await Promise.all([
        this.connectedAccountModel.countDocuments({
          user: new Types.ObjectId(userId),
          isActive: true,
        }),
        this.getUsageCountsForFeatures(
          userId,
          [FEATURE_KEYS.SCHEDULED_POSTS, FEATURE_KEYS.CREDITS],
          usagePeriod.periodStart,
        ),
        this.artifactModel.aggregate<{ _id: ArtifactType; count: number }>([
          {
            $match: {
              user: new Types.ObjectId(userId),
              createdAt: {
                $gte: usagePeriod.periodStart,
                $lt: usagePeriod.periodEnd,
              },
            },
          },
          { $group: { _id: '$type', count: { $sum: 1 } } },
        ]),
      ]);

    const artifactCountByType = new Map(
      artifactCounts.map(({ _id, count }) => [_id, count]),
    );

    const connectedAccountsLimit = this.getLimitFromTier(
      tier,
      FEATURE_KEYS.CONNECTED_ACCOUNTS,
    );
    const scheduledPostsLimit = this.getLimitFromTier(
      tier,
      FEATURE_KEYS.SCHEDULED_POSTS,
    );

    const scheduledPostsUsed =
      meteredUsageCounts[FEATURE_KEYS.SCHEDULED_POSTS] ?? 0;
    const creditsUsed = meteredUsageCounts[FEATURE_KEYS.CREDITS] ?? 0;
    const creditsLimit = this.getLimitFromTier(tier, FEATURE_KEYS.CREDITS);

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
        scheduled_posts: {
          used: scheduledPostsUsed,
          limit: scheduledPostsLimit,
          remaining: this.calculateRemaining(
            scheduledPostsUsed,
            scheduledPostsLimit,
          ),
        },
        credits: {
          used: creditsUsed,
          limit: creditsLimit,
          remaining:
            creditsLimit === -1
              ? -1
              : this.calculateRemaining(creditsUsed, creditsLimit),
        },
      },
      artifactsCreated: {
        posts: artifactCountByType.get(ArtifactType.POST) ?? 0,
        polls: artifactCountByType.get(ArtifactType.POLL) ?? 0,
        documents: artifactCountByType.get(ArtifactType.DOCUMENT) ?? 0,
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
