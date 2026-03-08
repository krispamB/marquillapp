import { ForbiddenException } from '@nestjs/common';
import type { FeatureKey } from './feature-gating.constants';

type FeatureGateTier = {
  id: string;
  name: string;
};

type FeatureGatePayload = {
  code: string;
  feature: FeatureKey;
  limit: number;
  currentUsage: number;
  tier: FeatureGateTier;
  upgradeHint: string;
};

export class FeatureGateForbiddenException extends ForbiddenException {
  constructor(payload: FeatureGatePayload) {
    super(payload);
  }
}
