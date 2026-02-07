import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
    Subscription,
    SubscriptionStatus,
    BillingCycle,
} from '../database/schemas/subscription.schema';
import { User } from '../database/schemas/user.schema';
import { Tier } from '../database/schemas/tier.schema';
import { addMonths, addYears } from 'date-fns';

@Injectable()
export class SubscriptionService {
    private readonly logger = new Logger(SubscriptionService.name);

    constructor(
        @InjectModel(Subscription.name)
        private subscriptionModel: Model<Subscription>,
        @InjectModel(Tier.name) private tierModel: Model<Tier>,
    ) { }

    async createSubscription(
        user: User,
        tier: Tier,
        billingCycle: BillingCycle,
    ): Promise<Subscription> {
        const startDate = new Date();
        let currentPeriodEnd: Date;

        if (billingCycle === BillingCycle.MONTHLY) {
            currentPeriodEnd = addMonths(startDate, 1);
        } else {
            currentPeriodEnd = addYears(startDate, 1);
        }

        const subscription = new this.subscriptionModel({
            user: user._id,
            tier: tier._id,
            billingCycle,
            status: SubscriptionStatus.ACTIVE,
            startDate,
            currentPeriodStart: startDate,
            currentPeriodEnd,
            cancelAtPeriodEnd: false,
        });

        return subscription.save();
    }

    //under review: create new subscription and make old sub invalid
    async renewSubscription(subscriptionId: string): Promise<Subscription> {
        const subscription = await this.subscriptionModel.findById(subscriptionId);
        if (!subscription) {
            throw new NotFoundException('Subscription not found');
        }
        
        if (subscription.status !== SubscriptionStatus.ACTIVE && subscription.status !== SubscriptionStatus.PAST_DUE) {
            // Depending on business logic, maybe we can only renew active. But let's assume active unless cancelled.
            // Requirement says "renew logic".
        }

        // Logic: Extend from current end date if it's not too far in the past? Or from now?
        // Often renew means extend. Assuming seamless renewal.
        const newPeriodStart = subscription.currentPeriodEnd; // Or now if expired?
        let newPeriodEnd: Date;

        if (subscription.billingCycle === BillingCycle.MONTHLY) {
            newPeriodEnd = addMonths(newPeriodStart, 1);
        } else {
            newPeriodEnd = addYears(newPeriodStart, 1);
        }

        subscription.currentPeriodStart = newPeriodStart;
        subscription.currentPeriodEnd = newPeriodEnd;
        subscription.status = SubscriptionStatus.ACTIVE; // Ensure active if it was past due

        return subscription.save();
    }

    async checkSubscriptionStatus(subscriptionId: string): Promise<Subscription> {
        const subscription = await this.subscriptionModel.findById(subscriptionId);
        if (!subscription) {
            throw new NotFoundException('Subscription not found');
        }

        if (subscription.status === SubscriptionStatus.ACTIVE) {
            if (new Date() > subscription.currentPeriodEnd) {
                subscription.status = SubscriptionStatus.EXPIRED; // Or PAST_DUE
                await subscription.save();
            }
        }
        return subscription;
    }

    // async upgradeSubscription(subscriptionId: string, newTierId: string): Promise<Subscription> {
    //     const subscription = await this.subscriptionModel.findById(subscriptionId);
    //     if (!subscription) {
    //         throw new NotFoundException('Subscription not found');
    //     }

    //     const newTier = await this.tierModel.findById(newTierId);
    //     if (!newTier) {
    //         throw new NotFoundException('Tier not found');
    //     }

    //     // Stub logic: Reset period start to now.
    //     const now = new Date();
    //     subscription.tier = newTier;
    //     subscription.startDate = now; // optional: reset startDate or keep original? Keeping original is better usually, but for upgrade let's reset period.
    //     subscription.currentPeriodStart = now;
    //     if (subscription.billingCycle === BillingCycle.MONTHLY) {
    //         subscription.currentPeriodEnd = addMonths(now, 1);
    //     } else {
    //         subscription.currentPeriodEnd = addYears(now, 1);
    //     }

    //     return subscription.save();
    // }
}
