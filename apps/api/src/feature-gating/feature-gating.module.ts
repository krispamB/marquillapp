import { Module } from '@nestjs/common';
import { FeatureGatingService } from './feature-gating.service';
import { SubscriptionAccessGuard } from '../common/guards/subscription-access.guard';

@Module({
  providers: [FeatureGatingService, SubscriptionAccessGuard],
  exports: [FeatureGatingService, SubscriptionAccessGuard],
})
export class FeatureGatingModule {}
