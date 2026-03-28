import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { SubscriptionStatus } from '../../database/schemas/subscription.schema';
import { Tier } from '../../database/schemas/tier.schema';
import { User } from '../../database/schemas/user.schema';
import { FeatureGatingService } from '../../feature-gating/feature-gating.service';

type RequestWithEntitlement = Request & {
  user: User;
  entitlementTier?: Tier | null;
  entitlementSource?: 'subscription' | 'default';
  subscriptionStatus?: SubscriptionStatus | null;
};

@Injectable()
export class SubscriptionAccessGuard implements CanActivate {
  private readonly logger = new Logger(SubscriptionAccessGuard.name);

  constructor(private readonly featureGatingService: FeatureGatingService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithEntitlement>();
    const userId = request.user?._id?.toString();

    if (!userId) {
      request.entitlementTier = null;
      request.entitlementSource = 'default';
      request.subscriptionStatus = null;
      return true;
    }

    const entitlement =
      await this.featureGatingService.resolveEntitlement(userId);
    if (!entitlement.tier) {
      this.logger.warn('Default tier missing during subscription fallback');
      request.entitlementTier = null;
      request.entitlementSource = 'default';
      request.subscriptionStatus = entitlement.subscriptionStatus;
      return true;
    }

    request.entitlementTier = entitlement.tier;
    request.entitlementSource = entitlement.source;
    request.subscriptionStatus = entitlement.subscriptionStatus;
    return true;
  }
}
