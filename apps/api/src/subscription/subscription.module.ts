import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SubscriptionService } from './subscription.service';
import { Subscription, SubscriptionSchema } from '../database/schemas/subscription.schema';
import { Tier, TierSchema } from '../database/schemas/tier.schema';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Subscription.name, schema: SubscriptionSchema },
            { name: Tier.name, schema: TierSchema },
        ]),
    ],
    providers: [SubscriptionService],
    exports: [SubscriptionService],
})
export class SubscriptionModule { }
