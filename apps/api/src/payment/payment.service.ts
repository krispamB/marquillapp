import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import {
  BillingInterval,
  BillingCustomer,
  PaymentProvider,
  Subscription,
  SubscriptionStatus,
  Tier,
  User,
} from '../database/schemas';
import { PaddleClient } from './paddle.client';
import { RedisService } from '../redis/redis.service';
import { FeatureGatingService } from '../feature-gating/feature-gating.service';

const WEBHOOK_DEDUPE_TTL_SECONDS = 172800; // 48h
const WEBHOOK_REDIS_KEY_PREFIX = 'billing:webhook:paddle:id:';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Tier.name) private readonly tierModel: Model<Tier>,
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<Subscription>,
    @InjectModel(BillingCustomer.name)
    private readonly billingCustomerModel: Model<BillingCustomer>,
    private readonly paddleClient: PaddleClient,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly featureGatingService: FeatureGatingService,
  ) {}

  async createCheckoutSession(
    userId: string,
    tierId: string,
    billingInterval: BillingInterval,
  ) {
    const userObjectId = new Types.ObjectId(userId);
    const user = await this.userModel.findById(userObjectId).lean();
    if (!user) throw new NotFoundException('User not found');

    const targetTier = await this.tierModel
      .findById(new Types.ObjectId(tierId))
      .lean();

    if (!targetTier) {
      throw new NotFoundException('Tier not found');
    }

    if (!targetTier.isActive) {
      throw new BadRequestException(`Tier "${targetTier.name}" is not active`);
    }

    const priceId =
      billingInterval === BillingInterval.MONTHLY
        ? targetTier.paddleMonthlyPriceId
        : targetTier.paddleYearlyPriceId;

    if (!priceId) {
      throw new BadRequestException(
        `Tier "${targetTier.name}" is missing Paddle ${billingInterval} price ID`,
      );
    }

    const { checkoutUrl } = await this.paddleClient.createTransaction({
      priceId,
      userId: user._id.toString(),
    });

    return {
      url: checkoutUrl,
      tier: {
        id: targetTier._id.toString(),
        name: targetTier.name,
      },
      billingInterval,
    };
  }

  async handlePaddleWebhook(rawBody: Buffer, paddleSignature: string) {
    const webhookSecret = this.configService.getOrThrow<string>(
      'PADDLE_WEBHOOK_SECRET',
    );

    let event: any;
    try {
      event = await this.paddleClient
        .getWebhooksHelper()
        .unmarshal(rawBody.toString(), webhookSecret, paddleSignature);
    } catch {
      throw new ForbiddenException('Invalid webhook signature');
    }

    const eventType: string = event.eventType ?? 'unknown';
    const eventId: string = event.eventId ?? '';

    if (!eventId) {
      throw new BadRequestException('Missing eventId in webhook payload');
    }

    const key = `${WEBHOOK_REDIS_KEY_PREFIX}${eventId}`;
    const stored = await this.storeWebhookTypeIfNew(key, eventType);
    if (!stored) {
      return { processed: false, duplicate: true, eventId };
    }

    if (!this.isSubscriptionEvent(eventType)) {
      this.logger.warn(
        `Ignoring unhandled Paddle event type: ${eventType} (${eventId})`,
      );
      return { processed: true, duplicate: false, ignored: true, eventId };
    }

    try {
      await this.syncSubscriptionFromEvent(event.data, eventType);
      return { processed: true, duplicate: false, eventId };
    } catch (error) {
      // Remove dedup key so Paddle's retries can still succeed
      await this.redisService.getClient().del(key).catch(() => {});
      const message =
        error instanceof Error ? error.message : 'Unknown processing error';
      this.logger.error(
        `Failed processing Paddle event ${eventId}: ${message}`,
      );
      throw error;
    }
  }

  async getBillingSummary(userId: string) {
    const userObjectId = new Types.ObjectId(userId);
    const now = new Date();

    const subscription = await this.subscriptionModel
      .findOne({ userId: userObjectId })
      .sort({ updatedAt: -1 })
      .lean();

    const isActivePaid =
      !!subscription &&
      (subscription.status === SubscriptionStatus.ACTIVE ||
        subscription.status === SubscriptionStatus.PAST_DUE) &&
      subscription.currentPeriodEnd > now;

    if (isActivePaid) {
      const paidTier = await this.tierModel
        .findById(subscription.tierId)
        .lean();
      return {
        tier: paidTier
          ? {
              id: paidTier._id.toString(),
              name: paidTier.name,
              isDefault: paidTier.isDefault,
            }
          : null,
        billingInterval: subscription.billingInterval,
        nextRenewalDate: subscription.currentPeriodEnd,
        subscriptionStatus: subscription.status,
      };
    }

    const defaultTier = await this.tierModel
      .findOne({ isDefault: true, isActive: true })
      .lean();
    if (!defaultTier) {
      throw new NotFoundException('Default tier not configured');
    }

    return {
      tier: {
        id: defaultTier._id.toString(),
        name: defaultTier.name,
        isDefault: defaultTier.isDefault,
      },
      billingInterval: null,
      nextRenewalDate: null,
      subscriptionStatus: subscription?.status ?? SubscriptionStatus.EXPIRED,
    };
  }

  async getInvoiceHistory(userId: string) {
    const userObjectId = new Types.ObjectId(userId);

    const billingCustomer = await this.billingCustomerModel
      .findOne({ user: userObjectId, provider: PaymentProvider.PADDLE })
      .lean();

    if (!billingCustomer) {
      return { items: [] };
    }

    const transactions = await this.paddleClient.listTransactions({
      customerId: billingCustomer.providerCustomerId,
    });

    const items = transactions.map((tx) => ({
      id: tx.id,
      customer: tx.customData?.name,
      plan: tx.details?.lineItems?.[0]?.product?.name,
      amount: tx.details?.totals?.grandTotal,
      status: tx.status,
      date: tx.createdAt,
    }));

    return { items };
  }

  async getUsageSummary(userId: string) {
    return this.featureGatingService.getDashboardUsage(userId);
  }

  async cancelSubscription(userId: string) {
    const userObjectId = new Types.ObjectId(userId);
    const subscription = await this.subscriptionModel
      .findOne({ userId: userObjectId })
      .lean();

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    if (!subscription.paddleSubscriptionId) {
      throw new UnprocessableEntityException(
        'Subscription is missing Paddle reference. Please contact support.',
      );
    }

    if (
      subscription.cancelAtPeriodEnd ||
      subscription.status === SubscriptionStatus.CANCELED ||
      subscription.status === SubscriptionStatus.EXPIRED
    ) {
      return this.getBillingSummary(userId);
    }

    await this.paddleClient.cancelSubscriptionAtPeriodEnd(
      subscription.paddleSubscriptionId,
    );

    await this.subscriptionModel.findOneAndUpdate(
      { userId: userObjectId },
      { cancelAtPeriodEnd: true },
      { new: true },
    );

    return this.getBillingSummary(userId);
  }

  private isSubscriptionEvent(eventType: string): boolean {
    return [
      'subscription.created',
      'subscription.activated',
      'subscription.updated',
      'subscription.canceled',
      'subscription.paused',
      'subscription.resumed',
      'subscription.past_due',
      'transaction.completed',
    ].includes(eventType);
  }

  private async syncSubscriptionFromEvent(data: any, eventType: string) {
    const customData = data?.customData ?? {};
    const userId: string | undefined = customData.userId;

    if (!userId) {
      throw new BadRequestException(
        'Webhook payload missing userId in customData',
      );
    }

    const customerId: string | undefined = data?.customerId;

    if (customerId) {
      await this.billingCustomerModel.findOneAndUpdate(
        { user: new Types.ObjectId(userId), provider: PaymentProvider.PADDLE },
        {
          user: new Types.ObjectId(userId),
          provider: PaymentProvider.PADDLE,
          providerCustomerId: customerId,
        },
        { upsert: true, new: true },
      );
    }

    // transaction.completed confirms payment but carries no subscription period data
    if (eventType === 'transaction.completed') return;

    const paddleSubscriptionId: string = data?.id;
    const status = this.mapPaddleStatus(data?.status ?? null);

    const currentPeriodStart = data?.currentBillingPeriod?.startsAt
      ? new Date(data.currentBillingPeriod.startsAt)
      : new Date();
    const currentPeriodEnd = data?.currentBillingPeriod?.endsAt
      ? new Date(data.currentBillingPeriod.endsAt)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const cancelAtPeriodEnd = data?.scheduledChange?.action === 'cancel';

    const priceId: string | undefined = data?.items?.[0]?.price?.id;
    const tierAndInterval = await this.resolveTierAndIntervalByPriceId(
      priceId ?? null,
    );

    if (!tierAndInterval) {
      throw new BadRequestException('Unable to map Paddle price ID to tier');
    }

    await this.subscriptionModel.findOneAndUpdate(
      { userId: new Types.ObjectId(userId) },
      {
        userId: new Types.ObjectId(userId),
        tierId: new Types.ObjectId(tierAndInterval.tierId),
        billingInterval: tierAndInterval.billingInterval,
        status,
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd,
        paddleSubscriptionId,
      },
      { upsert: true, new: true },
    );
  }

  private async resolveTierAndIntervalByPriceId(
    priceId: string | null,
  ): Promise<{
    tierId: string;
    billingInterval: BillingInterval;
  } | null> {
    if (!priceId) return null;

    const tier = await this.tierModel
      .findOne({
        $or: [
          { paddleMonthlyPriceId: priceId },
          { paddleYearlyPriceId: priceId },
        ],
      })
      .lean();
    if (!tier) return null;

    if (tier.paddleMonthlyPriceId === priceId) {
      return {
        tierId: tier._id.toString(),
        billingInterval: BillingInterval.MONTHLY,
      };
    }

    return {
      tierId: tier._id.toString(),
      billingInterval: BillingInterval.YEARLY,
    };
  }

  private mapPaddleStatus(status: string | null): SubscriptionStatus {
    switch ((status ?? '').toLowerCase()) {
      case 'active':
      case 'trialing':
        return SubscriptionStatus.ACTIVE;
      case 'past_due':
        return SubscriptionStatus.PAST_DUE;
      case 'canceled':
      case 'cancelled':
        return SubscriptionStatus.CANCELED;
      case 'paused':
        return SubscriptionStatus.EXPIRED;
      default:
        return SubscriptionStatus.EXPIRED;
    }
  }

  private async storeWebhookTypeIfNew(
    key: string,
    eventType: string,
  ): Promise<boolean> {
    const client = this.redisService.getClient();
    const response = await client.set(
      key,
      eventType,
      'EX',
      WEBHOOK_DEDUPE_TTL_SECONDS,
      'NX',
    );
    return response === 'OK';
  }
}
