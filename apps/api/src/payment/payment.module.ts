import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentService } from './payment.service';
import { PaddleClient } from './paddle.client';
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
import { FeatureGatingModule } from '../feature-gating';

@Module({
  imports: [
    DatabaseModule,
    RedisModule,
    FeatureGatingModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Tier.name, schema: TierSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: BillingCustomer.name, schema: BillingCustomerSchema },
    ]),
  ],
  controllers: [PaymentController, PaymentWebhookController],
  providers: [PaymentService, PaddleClient],
  exports: [PaymentService],
})
export class PaymentModule {}
