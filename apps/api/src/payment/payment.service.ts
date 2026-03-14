import {
  BadRequestException,
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
  validateEvent,
  WebhookVerificationError,
} from '@polar-sh/sdk/webhooks';
import {
  BillingInterval,
  BillingCustomer,
  PaymentProvider,
  Subscription,
  SubscriptionStatus,
  Tier,
  User,
} from '../database/schemas';
import { PolarClient } from './polar.client';
import { RedisService } from '../redis/redis.service';

const WEBHOOK_DEDUPE_TTL_SECONDS = 172800; // 48h
const WEBHOOK_REDIS_KEY_PREFIX = 'billing:webhook:polar:id:';

type PolarWebhookPayload = {
  type?: string;
  data?: Record<string, any>;
  subscription?: Record<string, any>;
};

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
    private readonly polarClient: PolarClient,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
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
        ? targetTier.polarMonthlyPriceId
        : targetTier.polarYearlyPriceId;

    if (!priceId) {
      throw new BadRequestException(
        `Tier "${targetTier.name}" is missing Polar ${billingInterval} price ID`,
      );
    }

    const successUrl = this.configService.get<string>(
      'POLAR_CHECKOUT_SUCCESS_URL',
    );
    const cancelUrl = this.configService.get<string>(
      'POLAR_CHECKOUT_CANCEL_URL',
    );

    if (!successUrl || !cancelUrl) {
      throw new InternalServerErrorException(
        'POLAR_CHECKOUT_SUCCESS_URL and POLAR_CHECKOUT_CANCEL_URL must be configured',
      );
    }

    const checkout = await this.polarClient.createCheckoutSession({
      priceId,
      userId: user._id.toString(),
      successUrl,
      cancelUrl,
    });

    return {
      url: checkout.url,
      tier: {
        id: targetTier._id.toString(),
        name: targetTier.name,
      },
      billingInterval,
    };
  }

  async handlePolarWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ) {
    const webhookSecret = this.configService.get<string>(
      'POLAR_WEBHOOK_SECRET',
    );
    if (!webhookSecret) {
      throw new InternalServerErrorException(
        'POLAR_WEBHOOK_SECRET is not configured',
      );
    }

    const normalizedHeaders = this.normalizeHeaders(headers);
    let payload: PolarWebhookPayload;

    try {
      payload = validateEvent(
        rawBody,
        normalizedHeaders,
        webhookSecret,
      ) as PolarWebhookPayload;
    } catch (error) {
      if (error instanceof WebhookVerificationError) throw error;
      throw new BadRequestException('Invalid webhook payload');
    }

    const eventType = payload.type ?? 'unknown';
    const webhookId = normalizedHeaders['webhook-id'];
    if (!webhookId) {
      throw new BadRequestException('Missing webhook-id header');
    }

    const eventId = webhookId;
    const key = `${WEBHOOK_REDIS_KEY_PREFIX}${eventId}`;

    const stored = await this.storeWebhookTypeIfNew(key, eventType);
    if (!stored) {
      return { processed: false, duplicate: true, eventId };
    }

    if (!this.isSubscriptionEvent(eventType)) {
      this.logger.warn(
        `Ignoring unknown Polar event type: ${eventType} (${eventId})`,
      );
      return { processed: true, duplicate: false, ignored: true, eventId };
    }

    try {
      await this.syncSubscriptionFromEvent(payload, eventType);
      return { processed: true, duplicate: false, eventId };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown processing error';
      this.logger.error(`Failed processing Polar event ${eventId}: ${message}`);
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
      subscription.status === SubscriptionStatus.ACTIVE &&
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
    const user = await this.userModel.findById(userObjectId).lean();
    if (!user) throw new NotFoundException('User not found');

    const paymentsIterator = await this.polarClient.listInvoices({
      customerEmail: user.email,
    });

    const items: any[] = [];
    for await (const page of paymentsIterator) {
      items.push(...(page.result?.items ?? []));
    }

    return { items };
  }

  async cancelSubscription(userId: string) {
    const userObjectId = new Types.ObjectId(userId);
    const subscription = await this.subscriptionModel
      .findOne({ userId: userObjectId })
      .lean();

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    if (!subscription.polarSubscriptionId) {
      throw new UnprocessableEntityException(
        'Subscription is missing Polar reference. Please contact support.',
      );
    }

    if (
      subscription.cancelAtPeriodEnd ||
      subscription.status === SubscriptionStatus.CANCELED ||
      subscription.status === SubscriptionStatus.EXPIRED
    ) {
      return this.getBillingSummary(userId);
    }

    await this.polarClient.cancelSubscriptionAtPeriodEnd(
      subscription.polarSubscriptionId,
    );

    await this.subscriptionModel.findOneAndUpdate(
      { userId: userObjectId },
      {
        cancelAtPeriodEnd: true,
      },
      { new: true },
    );

    return this.getBillingSummary(userId);
  }

  private isSubscriptionEvent(eventType: string): boolean {
    return (
      eventType === 'subscription.created' ||
      eventType === 'subscription.updated' ||
      eventType === 'subscription.canceled' ||
      eventType === 'subscription.active' ||
      eventType === 'subscription.revoked' ||
      eventType === 'subscription.uncanceled'
    );
  }

  private async syncSubscriptionFromEvent(
    payload: PolarWebhookPayload,
    eventType: string,
  ) {
    const data = payload.data ?? {};
    const metadata = (data.metadata ?? {}) as Record<string, any>;

    const userId = this.readString([metadata.userId, metadata.user_id]);

    if (!userId) {
      throw new BadRequestException('Webhook payload missing userId metadata');
    }

    const customerId = this.readString([data.customer_id, data.customerId]);

    if (customerId) {
      await this.billingCustomerModel.findOneAndUpdate(
        { user: new Types.ObjectId(userId), provider: PaymentProvider.POLAR },
        {
          user: new Types.ObjectId(userId),
          provider: PaymentProvider.POLAR,
          providerCustomerId: customerId,
        },
        { upsert: true, new: true },
      );
    }

    const existingSubscription = await this.subscriptionModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .lean();

    const periodStartRaw = this.readString([
      data.current_period_start,
      data.currentPeriodStart,
    ]);
    const periodEndRaw = this.readString([
      data.current_period_end,
      data.currentPeriodEnd,
    ]);

    const currentPeriodStart = periodStartRaw
      ? new Date(periodStartRaw)
      : new Date();
    const currentPeriodEnd = periodEndRaw
      ? new Date(periodEndRaw)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const status = this.mapPolarStatus(
      this.readString([data.status, payload.type]),
    );
    const cancelAtPeriodEnd = this.readBoolean([
      data.cancel_at_period_end,
      data.cancelAtPeriodEnd,
    ]);

    const polarSubscriptionId = this.readString([
      data.subscription_id,
      data.id,
    ]);

    const isResubscriptionEvent = eventType === 'subscription.updated';
    const shouldApplyTier =
      isResubscriptionEvent && status === SubscriptionStatus.ACTIVE;
    const shouldResolveTier = shouldApplyTier || !existingSubscription;

    let tierId: string | null = existingSubscription?.tierId
      ? existingSubscription.tierId.toString()
      : null;
    let billingInterval: BillingInterval | null =
      existingSubscription?.billingInterval ?? null;

    if (shouldResolveTier) {
      const priceId = this.readString([data.product_id, data.productId]);
      const tierAndInterval =
        await this.resolveTierAndIntervalByPriceId(priceId);
      tierId = tierAndInterval?.tierId ?? null;
      billingInterval = tierAndInterval?.billingInterval ?? null;
    }

    if (!tierId || !billingInterval) {
      throw new BadRequestException('Unable to map Polar price to tier');
    }

    await this.subscriptionModel.findOneAndUpdate(
      { userId: new Types.ObjectId(userId) },
      {
        userId: new Types.ObjectId(userId),
        tierId: new Types.ObjectId(tierId),
        billingInterval,
        status,
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd,
        polarSubscriptionId: polarSubscriptionId ?? undefined,
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
          { polarMonthlyPriceId: priceId },
          { polarYearlyPriceId: priceId },
        ],
      })
      .lean();
    if (!tier) return null;

    if (tier.polarMonthlyPriceId === priceId) {
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

  private mapPolarStatus(status: string | null): SubscriptionStatus {
    switch ((status ?? '').toLowerCase()) {
      case 'active':
      case 'subscription.active':
      case 'subscription.uncanceled':
        return SubscriptionStatus.ACTIVE;
      case 'past_due':
      case 'past-due':
      case 'subscription.past_due':
        return SubscriptionStatus.PAST_DUE;
      case 'canceled':
      case 'cancelled':
      case 'subscription.canceled':
      case 'subscription.revoked':
        return SubscriptionStatus.CANCELED;
      case 'expired':
        return SubscriptionStatus.EXPIRED;
      default:
        return SubscriptionStatus.EXPIRED;
    }
  }

  private readString(values: unknown[]): string | null {
    for (const value of values) {
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }
    return null;
  }

  private readBoolean(values: unknown[]): boolean {
    for (const value of values) {
      if (typeof value === 'boolean') return value;
    }
    return false;
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

  private normalizeHeaders(
    headers: Record<string, string | string[] | undefined>,
  ): Record<string, string> {
    const normalized: Record<string, string> = {};

    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === 'string') {
        normalized[key.toLowerCase()] = value;
      } else if (Array.isArray(value) && value.length > 0) {
        normalized[key.toLowerCase()] = value[0];
      }
    }

    return normalized;
  }
}
