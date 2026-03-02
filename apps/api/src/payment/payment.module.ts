import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentService } from './payment.service';
import { PolarClient } from './polar.client';
import { DatabaseModule } from '../database/database.module';
import { RedisModule } from '../redis/redis.module';
import {
  BillingCustomer,
  BillingCustomerSchema,
  Subscription,
  SubscriptionSchema,
  Tier,
  TierSchema,
  User,
  UserSchema,
} from '../database/schemas';
import { PaymentController } from './payment.controller';
import { PaymentWebhookController } from './payment.webhook.controller';

@Module({
  imports: [
    DatabaseModule,
    RedisModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Tier.name, schema: TierSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: BillingCustomer.name, schema: BillingCustomerSchema },
    ]),
  ],
  controllers: [PaymentController, PaymentWebhookController],
  providers: [PaymentService, PolarClient],
  exports: [PaymentService],
})
export class PaymentModule { }
