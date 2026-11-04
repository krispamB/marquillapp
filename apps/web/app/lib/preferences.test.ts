import { describe, expect, test } from "bun:test";
import { formatTimezoneLabel, formatTimezoneOffset, isThemePreference, listTimezones } from "./preferences";

describe("preferences", () => {
  test("recognises only the three theme preferences", () => {
    expect(["system", "light", "dark"].every(isThemePreference)).toBe(true);
    expect(isThemePreference("sepia")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });

  test("formats a zone's offset at a given moment", () => {
    const winter = new Date("2026-01-15T12:00:00Z");
    expect(formatTimezoneOffset("Africa/Lagos", winter)).toBe("GMT+1");
    expect(formatTimezoneOffset("UTC", winter)).toBe("GMT");
    expect(formatTimezoneOffset("Not/AZone", winter)).toBe("GMT");
  });

  test("labels a zone readably", () => {
    expect(formatTimezoneLabel("America/New_York")).toStartWith("America/New York (GMT-");
  });

  test("always offers UTC", () => {
    expect(listTimezones()).toContain("UTC");
  });
});
