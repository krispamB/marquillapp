type TierIdentity = {
  name?: string | null;
  isDefault?: boolean;
} | null | undefined;

function normalizedTierName(tier: TierIdentity) {
  return tier?.name?.trim().toLowerCase().replace(/\s+plan$/, "") ?? "";
}

export function isFreeTier(tier: TierIdentity) {
  return tier?.isDefault === true || normalizedTierName(tier) === "free";
}

export function canUseResearch(tier: TierIdentity) {
  return Boolean(tier) && !isFreeTier(tier);
}
