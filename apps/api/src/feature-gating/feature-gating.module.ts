import { Module } from '@nestjs/common';
import { CreditMeterService } from './credit-meter.service';
import { FeatureGatingService } from './feature-gating.service';
import { SubscriptionAccessGuard } from '../common/guards/subscription-access.guard';

@Module({
  providers: [
    FeatureGatingService,
    CreditMeterService,
    SubscriptionAccessGuard,
  ],
  exports: [FeatureGatingService, CreditMeterService, SubscriptionAccessGuard],
})
export class FeatureGatingModule {}
