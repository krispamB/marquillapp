import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { User } from './user.schema';
import { Tier } from './tier.schema';

export enum SubscriptionStatus {
    ACTIVE = 'ACTIVE',
    CANCELLED = 'CANCELLED',
    EXPIRED = 'EXPIRED',
    PAST_DUE = 'PAST_DUE',
    PENDING = 'PENDING',
}

export enum BillingCycle {
    MONTHLY = 'MONTHLY',
    YEARLY = 'YEARLY',
}

export enum PaymentProvider {
    STRIPE = 'STRIPE',
    LEMON_SQUEEZY = 'LEMON_SQUEEZY',
    PAYPAL = 'PAYPAL',
}

@Schema({ timestamps: true })
export class Subscription extends Document {
    @Prop({ type: Types.ObjectId, ref: User.name, required: true })
    user: User;

    @Prop({ type: Types.ObjectId, ref: Tier.name, required: true })
    tier: Tier;

    @Prop({ required: true, enum: BillingCycle })
    billingCycle: BillingCycle;

    @Prop({
        required: true,
        enum: SubscriptionStatus,
        default: SubscriptionStatus.PENDING,
    })
    status: SubscriptionStatus;

    @Prop({ required: true })
    startDate: Date;

    @Prop()
    endDate?: Date;

    @Prop({ required: true })
    currentPeriodStart: Date;

    @Prop({ required: true })
    currentPeriodEnd: Date;

    @Prop({ default: false })
    cancelAtPeriodEnd: boolean;

    @Prop({ enum: PaymentProvider })
    provider?: PaymentProvider;

    @Prop({ required: true })
    amountPaid: number;

    @Prop({ required: true })
    currency: string;

    @Prop()
    providerSubscriptionId?: string;
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);
