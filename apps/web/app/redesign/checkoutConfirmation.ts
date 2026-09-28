import type { BillingSummaryResponse } from "../lib/types";

/**
 * sessionStorage key holding the tier ID the user is checking out for. Set just
 * before leaving for the landing checkout page, read when Paddle sends the user
 * back to `/billing?checkout=success`.
 */
export const PENDING_CHECKOUT_TIER_KEY = "marquill:pending-checkout-tier";

export const CHECKOUT_POLL_INTERVAL_MS = 2000;
export const CHECKOUT_POLL_TIMEOUT_MS = 30000;

/**
 * Whether the backend has recorded the purchased plan. The subscription is
 * written by Paddle's webhook, which can land after the browser is redirected
 * back, so the billing page polls until this returns true.
 *
 * With a known pending tier, wait for exactly that tier (covers paid-to-paid
 * plan changes). Without one (e.g. sessionStorage was cleared), accept any
 * non-default tier.
 */
export function isCheckoutConfirmed(
  summary: BillingSummaryResponse | null,
  pendingTierId: string | null,
): boolean {
  const tier = summary?.tier;
  if (!tier) return false;
  if (pendingTierId) return tier.id === pendingTierId;
  return tier.isDefault === false;
}
