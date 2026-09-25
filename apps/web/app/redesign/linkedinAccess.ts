import type { ConnectedAccount } from "../lib/types";

const DAY_MS = 86_400_000;

export type LinkedInAccountAccess = {
  isUsable: boolean;
  isExpired: boolean;
  isInactive: boolean;
  expiresAt?: string;
  statusLabel: "Active" | "Expired" | "Inactive";
  detailLabel?: string;
  isUrgent: boolean;
};

function expiryTimestamp(expiresAt?: string) {
  if (!expiresAt) return null;
  const timestamp = new Date(expiresAt).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function sharedPersonalExpiry(accounts: ConnectedAccount[]) {
  return accounts.find(
    (account) => account.accountType !== "ORGANIZATION" && expiryTimestamp(account.accessTokenExpiresAt) !== null,
  )?.accessTokenExpiresAt;
}

export function getLinkedInAccountAccess(
  account: ConnectedAccount,
  accounts: ConnectedAccount[] = [account],
  now = Date.now(),
): LinkedInAccountAccess {
  const expiresAt = account.accessTokenExpiresAt
    ?? (account.accountType === "ORGANIZATION" ? sharedPersonalExpiry(accounts) : undefined);
  const timestamp = expiryTimestamp(expiresAt);
  const isExpired = timestamp !== null && timestamp <= now;
  const isInactive = account.isActive === false;
  const isUsable = !isExpired && !isInactive;

  if (isExpired) {
    return {
      isUsable,
      isExpired,
      isInactive,
      expiresAt,
      statusLabel: "Expired",
      detailLabel: "Access expired",
      isUrgent: true,
    };
  }

  if (isInactive) {
    return {
      isUsable,
      isExpired,
      isInactive,
      expiresAt,
      statusLabel: "Inactive",
      detailLabel: "Account inactive",
      isUrgent: true,
    };
  }

  if (timestamp !== null) {
    const days = Math.max(1, Math.ceil((timestamp - now) / DAY_MS));
    return {
      isUsable,
      isExpired,
      isInactive,
      expiresAt,
      statusLabel: "Active",
      detailLabel: `Access ends in ${days} day${days === 1 ? "" : "s"}`,
      isUrgent: days <= 7,
    };
  }

  return {
    isUsable,
    isExpired,
    isInactive,
    expiresAt,
    statusLabel: "Active",
    isUrgent: false,
  };
}

export function usableConnectedAccounts(accounts: ConnectedAccount[], now = Date.now()) {
  return accounts.filter((account) => getLinkedInAccountAccess(account, accounts, now).isUsable);
}

export function getLinkedInAccountAccessById(
  accountId: string | undefined,
  accounts: ConnectedAccount[],
  now = Date.now(),
) {
  const account = accounts.find((candidate) => candidate.id === accountId);
  return account ? getLinkedInAccountAccess(account, accounts, now) : null;
}

export function hasUsablePersonalLinkedInAccount(accounts: ConnectedAccount[], now = Date.now()) {
  return accounts.some(
    (account) => account.accountType !== "ORGANIZATION"
      && getLinkedInAccountAccess(account, accounts, now).isUsable,
  );
}

export const LINKEDIN_ACCESS_EXPIRED_MESSAGE = "LinkedIn access expired. Reconnect LinkedIn to continue.";
