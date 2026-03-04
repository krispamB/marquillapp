import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Tier } from '../database/schemas/tier.schema';
import { SubscriptionService } from '../subscription/subscription.service';

@Injectable()
export class TierService {
  constructor(
    @InjectModel(Tier.name) private readonly tierModel: Model<Tier>,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  async getActiveTiers(): Promise<Tier[]> {
    return this.tierModel
      .find({ isActive: true })
      .sort({ monthlyPrice: 1, name: 1 })
      .exec();
  }

  async getMyTier(userId: string): Promise<Tier> {
    return this.subscriptionService.getEntitlementTier(userId);
  }
}
