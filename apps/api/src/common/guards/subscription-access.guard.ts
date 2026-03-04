import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Request } from 'express';
import { Model, Types } from 'mongoose';
import {
  Subscription,
  SubscriptionStatus,
  Tier,
  User,
} from '../../database/schemas';

type RequestWithEntitlement = Request & {
  user: User;
  entitlementTier?: Tier | null;
  entitlementSource?: 'subscription' | 'default';
  subscriptionStatus?: SubscriptionStatus | null;
};

@Injectable()
export class SubscriptionAccessGuard implements CanActivate {
  private readonly logger = new Logger(SubscriptionAccessGuard.name);

  constructor(
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<Subscription>,
    @InjectModel(Tier.name)
    private readonly tierModel: Model<Tier>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithEntitlement>();
    const userId = request.user?._id?.toString();

    if (!userId) {
      request.entitlementTier = null;
      request.entitlementSource = 'default';
      request.subscriptionStatus = null;
      return true;
    }

    const now = new Date();
    const subscription = await this.subscriptionModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .sort({ updatedAt: -1 })
      .lean();

    if (
      subscription &&
      subscription.status === SubscriptionStatus.ACTIVE &&
      subscription.currentPeriodEnd > now
    ) {
      const paidTier = await this.tierModel
        .findById(subscription.tierId)
        .lean();
      if (paidTier) {
        request.entitlementTier = paidTier as Tier;
        request.entitlementSource = 'subscription';
        request.subscriptionStatus = subscription.status;
        return true;
      }
    }

    const defaultTier = await this.tierModel
      .findOne({ isDefault: true, isActive: true })
      .lean();
    if (!defaultTier) {
      this.logger.warn('Default tier missing during subscription fallback');
      request.entitlementTier = null;
      request.entitlementSource = 'default';
      request.subscriptionStatus = subscription?.status ?? null;
      return true;
    }

    request.entitlementTier = defaultTier as Tier;
    request.entitlementSource = 'default';
    request.subscriptionStatus = subscription?.status ?? null;
    return true;
  }
}
