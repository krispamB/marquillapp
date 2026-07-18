type TierIdentity = {
  isDefault?: boolean;
} | null | undefined;

export function canUseResearch(tier: TierIdentity) {
  return tier?.isDefault === false;
}
