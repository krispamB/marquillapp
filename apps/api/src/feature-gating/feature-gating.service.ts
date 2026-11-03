import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

import { readIntEnv } from '../common/env';
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

const DEFAULT_TIER_CACHE_TTL_MS = 60_000;
const DEFAULT_TIER_CACHE_KEY = 'default';

/** The usage period credits and scheduled posts are counted in. */
export interface UsagePeriod {
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Who the user is to the gates, from one subscription read. The tier and the
 * period always come from the same decision: a subscription whose tier
 * document is missing falls back to the default tier *and* the default period.
 */
export interface Entitlement {
  /** Null only when no default tier is configured. */
  tier: Tier | null;
  source: 'subscription' | 'default';
  subscriptionStatus: SubscriptionStatus | null;
  period: UsagePeriod;
}

@Injectable()
export class FeatureGatingService {
  // Tiers are written only by the seed script, so a short in-process cache is
  // safe. The subscription is never cached: a Paddle webhook must apply at once.
  private readonly tierCacheTtlMs: number;
  private readonly tierCache = new Map<
    string,
    { tier: Tier; expiresAt: number }
  >();

  constructor(
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<Subscription>,
    @InjectModel(Tier.name) private readonly tierModel: Model<Tier>,
    @InjectModel(Usage.name) private readonly usageModel: Model<Usage>,
    @InjectModel('ConnectedAccount')
    private readonly connectedAccountModel: Model<any>,
    @InjectModel(Artifact.name)
    private readonly artifactModel: Model<Artifact>,
    configService: ConfigService,
  ) {
    this.tierCacheTtlMs = readIntEnv(
      configService,
      'FEATURE_TIER_CACHE_TTL_MS',
      { default: DEFAULT_TIER_CACHE_TTL_MS },
    );
  }

  async resolveEntitlementTier(userId: string): Promise<Tier> {
    return this.tierOf(await this.resolveEntitlement(userId));
  }

  async resolveEntitlement(userId: string): Promise<Entitlement> {
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
      // Never populated here, so the reference is the id.
      const tierId = subscription.tierId as Types.ObjectId;
      const paidTier = await this.cachedTier(tierId.toString(), () =>
        this.tierModel.findById(tierId).lean(),
      );
      if (paidTier) {
        return {
          tier: paidTier,
          source: 'subscription',
          subscriptionStatus: subscription.status,
          period: {
            periodStart: new Date(subscription.currentPeriodStart),
            periodEnd: new Date(subscription.currentPeriodEnd),
          },
        };
      }
    }

    const defaultTier = await this.cachedTier(DEFAULT_TIER_CACHE_KEY, () =>
      this.tierModel.findOne({ isDefault: true, isActive: true }).lean(),
    );
    const periodStart = this.getCurrentUtcMonthStart();

    return {
      tier: defaultTier,
      source: 'default',
      subscriptionStatus: subscription?.status ?? null,
      period: {
        periodStart,
        periodEnd: this.getNextUtcMonthStart(periodStart),
      },
    };
  }

  /**
   * The launch gate: one entitlement for the research and balance checks, so
   * a launch reads the subscription once. Returns what it checked.
   */
  async assertLaunch(
    userId: string,
    options: { withResearch: boolean },
  ): Promise<Entitlement> {
    const entitlement = await this.resolveEntitlement(userId);
    if (options.withResearch) {
      await this.assertResearchAccess(userId, entitlement);
    }
    await this.assertBalance(userId, entitlement);
    return entitlement;
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

  async assertResearchAccess(
    userId: string,
    entitlement?: Entitlement,
  ): Promise<void> {
    const tier = this.tierOf(
      entitlement ?? (await this.resolveEntitlement(userId)),
    );
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
  // A passed entitlement is reused, so the check costs only the usage read.
  async assertBalance(
    userId: string,
    entitlement?: Entitlement,
  ): Promise<void> {
    const resolved = entitlement ?? (await this.resolveEntitlement(userId));
    const tier = this.tierOf(resolved);
    const limit = this.getLimitFromTier(tier, FEATURE_KEYS.CREDITS);

    if (limit === -1) return; // unlimited

    const currentUsage = await this.getUsageCount(
      userId,
      FEATURE_KEYS.CREDITS,
      resolved.period.periodStart,
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
  // A caller that already resolved the entitlement passes its period.
  async debit(
    userId: string,
    credits: number,
    period?: UsagePeriod,
  ): Promise<void> {
    if (credits <= 0) return;

    const periodStart =
      period?.periodStart ?? (await this.resolveUsagePeriodStart(userId));
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

  private async resolveUsagePeriod(
    userId: string,
  ): Promise<UsagePeriod & { source: 'subscription' | 'default' }> {
    const { period, source } = await this.resolveEntitlement(userId);
    return { ...period, source };
  }

  private tierOf(entitlement: Entitlement): Tier {
    if (!entitlement.tier) {
      throw new NotFoundException('Default tier not configured');
    }
    return entitlement.tier;
  }

  /** A missing tier is never cached, so a seed run is picked up at once. */
  private async cachedTier(
    key: string,
    read: () => Promise<unknown>,
  ): Promise<Tier | null> {
    const now = Date.now();
    const hit = this.tierCache.get(key);
    if (hit && hit.expiresAt > now) return hit.tier;

    const tier = ((await read()) as Tier | null) ?? null;
    if (tier && this.tierCacheTtlMs > 0) {
      this.tierCache.set(key, { tier, expiresAt: now + this.tierCacheTtlMs });
    } else {
      this.tierCache.delete(key);
    }
    return tier;
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
