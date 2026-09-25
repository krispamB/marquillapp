import { describe, expect, test } from "bun:test";
import { canUseResearch } from "./tier-access";

describe("tier feature access", () => {
  test("allows research only when the backend identifies a non-default tier", () => {
    expect(canUseResearch({ isDefault: false })).toBe(true);
    expect(canUseResearch({ isDefault: true })).toBe(false);
    expect(canUseResearch({})).toBe(false);
    expect(canUseResearch(null)).toBe(false);
  });
});
