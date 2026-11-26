import type { PaymentUsageMetric, SubscriptionTier } from "../lib/types";

type Tier = Pick<SubscriptionTier, "name" | "isDefault"> | null | undefined;

export function getPlanSummary(tier: Tier) {
  const tierName = tier?.name?.trim() || "Free";
  const isFreeTier = Boolean(
    tier && (
      tier.isDefault === true ||
      tierName.toLowerCase().replace(/\s+plan$/, "") === "free"
    ),
  );
  return { tierName, isFreeTier };
}

export function getCreditsRemaining(credits: PaymentUsageMetric | null | undefined) {
  if (!credits) return null;
  return Math.max(0, credits.remaining ?? credits.limit - credits.used);
}
