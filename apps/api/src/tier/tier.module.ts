import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Tier, TierSchema } from '../database/schemas/tier.schema';
import { SubscriptionModule } from '../subscription/subscription.module';
import { TierService } from './tier.service';
import { TierController } from './tier.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Tier.name, schema: TierSchema }]),
    SubscriptionModule,
  ],
  providers: [TierService],
  controllers: [TierController],
  exports: [TierService],
})
export class TierModule {}
