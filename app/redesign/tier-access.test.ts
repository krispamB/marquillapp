import { describe, expect, test } from "bun:test";
import { canUseResearch, isFreeTier } from "./tier-access";

describe("tier feature access", () => {
  test("recognizes default and named free tiers", () => {
    expect(isFreeTier({ name: "Starter", isDefault: true })).toBe(true);
    expect(isFreeTier({ name: "Free" })).toBe(true);
    expect(isFreeTier({ name: " free PLAN " })).toBe(true);
  });

  test("allows research only for a known paid tier", () => {
    expect(canUseResearch({ name: "Pro", isDefault: false })).toBe(true);
    expect(canUseResearch({ name: "Free", isDefault: true })).toBe(false);
    expect(canUseResearch(null)).toBe(false);
  });
});
