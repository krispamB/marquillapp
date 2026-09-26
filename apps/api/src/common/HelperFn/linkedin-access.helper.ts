export interface LinkedinAccessAccount {
  isActive?: boolean;
  accessToken?: string | null;
  accessTokenExpiresAt?: Date | string | null;
}

export function isLinkedinAccessUsable(
  account: LinkedinAccessAccount,
  now = Date.now(),
): boolean {
  if (!account.isActive || !account.accessToken) {
    return false;
  }

  if (account.accessTokenExpiresAt == null) {
    return true;
  }

  const expiresAt =
    account.accessTokenExpiresAt instanceof Date
      ? account.accessTokenExpiresAt.getTime()
      : new Date(account.accessTokenExpiresAt).getTime();

  return Number.isFinite(expiresAt) && expiresAt > now;
}
