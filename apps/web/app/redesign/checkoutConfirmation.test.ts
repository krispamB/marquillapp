import { describe, expect, test } from "bun:test";
import { isCheckoutConfirmed } from "./checkoutConfirmation";
import type { BillingSummaryResponse } from "../lib/types";

function summary(tier: BillingSummaryResponse["tier"]): BillingSummaryResponse {
  return {
    tier,
    billingInterval: null,
    nextRenewalDate: null,
    subscriptionStatus: "active",
  };
}

describe("isCheckoutConfirmed", () => {
  test("waits for the exact tier that was purchased", () => {
    const pro = summary({ id: "tier-pro", name: "Pro", isDefault: false });
    expect(isCheckoutConfirmed(pro, "tier-pro")).toBe(true);
    expect(isCheckoutConfirmed(pro, "tier-business")).toBe(false);
  });

  test("keeps waiting while the backend still reports the default tier", () => {
    const free = summary({ id: "tier-free", name: "Free", isDefault: true });
    expect(isCheckoutConfirmed(free, "tier-pro")).toBe(false);
    expect(isCheckoutConfirmed(free, null)).toBe(false);
  });

  test("accepts any paid tier when the purchased tier is unknown", () => {
    const pro = summary({ id: "tier-pro", name: "Pro", isDefault: false });
    expect(isCheckoutConfirmed(pro, null)).toBe(true);
  });

  test("treats a missing summary or tier as unconfirmed", () => {
    expect(isCheckoutConfirmed(null, "tier-pro")).toBe(false);
    expect(isCheckoutConfirmed(summary(null), null)).toBe(false);
  });
});
