import { describe, expect, test } from "bun:test";
import type { ConnectedAccount } from "../lib/types";
import {
  getLinkedInAccountAccess,
  getLinkedInAccountAccessById,
  hasUsablePersonalLinkedInAccount,
  usableConnectedAccounts,
} from "./linkedinAccess";

const NOW = Date.parse("2026-08-11T12:00:00.000Z");

function account(overrides: Partial<ConnectedAccount> = {}): ConnectedAccount {
  return {
    id: "personal-1",
    provider: "LINKEDIN",
    accountType: "PERSONAL",
    displayName: "Ada Lovelace",
    isActive: true,
    ...overrides,
  };
}

describe("LinkedIn account access", () => {
  test("accepts future, missing, and invalid expiry values", () => {
    expect(getLinkedInAccountAccess(account({ accessTokenExpiresAt: "2026-08-13T12:00:00.000Z" }), undefined, NOW)).toMatchObject({
      isUsable: true,
      isExpired: false,
      detailLabel: "Access ends in 2 days",
      isUrgent: true,
    });
    expect(getLinkedInAccountAccess(account(), undefined, NOW).isUsable).toBe(true);
    expect(getLinkedInAccountAccess(account({ accessTokenExpiresAt: "not-a-date" }), undefined, NOW).isUsable).toBe(true);
  });

  test("expires access at the exact timestamp and after it", () => {
    expect(getLinkedInAccountAccess(account({ accessTokenExpiresAt: "2026-08-11T12:00:00.000Z" }), undefined, NOW)).toMatchObject({
      isUsable: false,
      isExpired: true,
      statusLabel: "Expired",
    });
    expect(getLinkedInAccountAccess(account({ accessTokenExpiresAt: "2026-08-10T12:00:00.000Z" }), undefined, NOW).isUsable).toBe(false);
  });

  test("treats an explicitly inactive account as unusable", () => {
    expect(getLinkedInAccountAccess(account({ isActive: false }), undefined, NOW)).toMatchObject({
      isUsable: false,
      isInactive: true,
      statusLabel: "Inactive",
    });
  });

  test("applies the personal credential expiry to organization pages", () => {
    const accounts = [
      account({ accessTokenExpiresAt: "2026-08-10T12:00:00.000Z" }),
      account({ id: "organization-1", accountType: "ORGANIZATION", accessTokenExpiresAt: undefined }),
    ];

    expect(getLinkedInAccountAccess(accounts[1], accounts, NOW).isExpired).toBe(true);
    expect(usableConnectedAccounts(accounts, NOW)).toEqual([]);
    expect(hasUsablePersonalLinkedInAccount(accounts, NOW)).toBe(false);
  });

  test("keeps valid accounts usable in a mixed-access workspace", () => {
    const accounts = [
      account({ id: "expired", accessTokenExpiresAt: "2026-08-10T12:00:00.000Z" }),
      account({ id: "valid", accessTokenExpiresAt: "2026-09-10T12:00:00.000Z" }),
    ];

    expect(usableConnectedAccounts(accounts, NOW).map((item) => item.id)).toEqual(["valid"]);
    expect(getLinkedInAccountAccessById("expired", accounts, NOW)?.isUsable).toBe(false);
    expect(getLinkedInAccountAccessById("missing", accounts, NOW)).toBeNull();
  });
});
