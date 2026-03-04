import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from './user.schema';
import { Tier } from './tier.schema';

export enum SubscriptionStatus {
  ACTIVE = 'active',
  CANCELED = 'canceled',
  EXPIRED = 'expired',
  PAST_DUE = 'past_due',
}

export enum BillingInterval {
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
}

export enum PaymentProvider {
  POLAR = 'POLAR',
  STRIPE = 'STRIPE',
  LEMON_SQUEEZY = 'LEMON_SQUEEZY',
  PAYPAL = 'PAYPAL',
}

@Schema({ timestamps: true })
export class Subscription extends Document {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true, unique: true })
  userId: User | Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: Tier.name, required: true })
  tierId: Tier | Types.ObjectId;

  @Prop({ required: true, enum: BillingInterval })
  billingInterval: BillingInterval;

  @Prop({ required: true, enum: SubscriptionStatus })
  status: SubscriptionStatus;

  @Prop({ required: true })
  currentPeriodStart: Date;

  @Prop({ required: true })
  currentPeriodEnd: Date;

  @Prop({ default: false })
  cancelAtPeriodEnd: boolean;

  @Prop({ unique: true, sparse: true })
  polarSubscriptionId?: string;
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);
