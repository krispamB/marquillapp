import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  BillingInterval,
  Subscription,
  SubscriptionStatus,
} from '../database/schemas/subscription.schema';
import { Tier } from '../database/schemas/tier.schema';

@Injectable()
export class SubscriptionService {
  constructor(
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<Subscription>,
    @InjectModel(Tier.name) private readonly tierModel: Model<Tier>,
  ) {}

  async findByUserId(userId: string): Promise<Subscription | null> {
    return this.subscriptionModel.findOne({ userId: new Types.ObjectId(userId) });
  }

  async getEntitlementTier(userId: string): Promise<Tier> {
    const subscription = await this.subscriptionModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .lean();

    if (
      subscription &&
      subscription.status === SubscriptionStatus.ACTIVE &&
      subscription.currentPeriodEnd > new Date()
    ) {
      const paidTier = await this.tierModel.findById(subscription.tierId);
      if (paidTier) return paidTier;
    }

    const defaultTier = await this.tierModel.findOne({ isDefault: true, isActive: true });
    if (!defaultTier) {
      throw new NotFoundException('Default tier not configured');
    }

    return defaultTier;
  }

  async upsertFromBilling(data: {
    userId: string;
    tierId: string;
    billingInterval: BillingInterval;
    status: SubscriptionStatus;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
    polarSubscriptionId?: string;
  }): Promise<Subscription> {
    return this.subscriptionModel.findOneAndUpdate(
      { userId: new Types.ObjectId(data.userId) },
      {
        userId: new Types.ObjectId(data.userId),
        tierId: new Types.ObjectId(data.tierId),
        billingInterval: data.billingInterval,
        status: data.status,
        currentPeriodStart: data.currentPeriodStart,
        currentPeriodEnd: data.currentPeriodEnd,
        cancelAtPeriodEnd: data.cancelAtPeriodEnd,
        polarSubscriptionId: data.polarSubscriptionId,
      },
      { upsert: true, new: true },
    );
  }
}
