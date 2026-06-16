import { unstable_cache } from "next/cache";
import { cookies } from "next/headers";
import type {
  ConnectedAccount,
  ConnectedAccountsResponse,
  UserApiResponse,
} from "./types";

// Absolute backend URL for server-side fetches. The client uses the relative
// NEXT_PUBLIC_API_BASE_URL (= /api/v1) so Clerk's __session cookie stays
// same-origin; on the server we call the backend directly and forward the
// incoming cookie header (which carries __session).
const apiBase =
  process.env.BACKEND_API_URL ?? "http://localhost:3500/api/v1";

/**
 * Builds a Cookie header from the incoming request cookies (including Clerk's
 * `__session`) so it can be forwarded to the backend on server-side fetches.
 */
export async function getServerCookieHeader() {
  const cookieStore = await cookies();
  return cookieStore
    .getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
}

export function getCachedUser(cookieHeader: string, cacheKey: string) {
  return unstable_cache(
    async () => {
      const res = await fetch(`${apiBase}/users/me`, {
        headers: { cookie: cookieHeader },
      });
      if (!res.ok) return null;
      return res.json() as Promise<UserApiResponse>;
    },
    ["user-me", cacheKey],
    { revalidate: 300 }
  )();
}

export function getCachedSubscription(cookieHeader: string, cacheKey: string) {
  return unstable_cache(
    async () => {
      const res = await fetch(`${apiBase}/payment/subscription`, {
        headers: { cookie: cookieHeader },
      });
      if (!res.ok) return null;
      const body = await res.json();
      return (body?.tier ?? null) as { name: string; isDefault: boolean } | null;
    },
    ["subscription", cacheKey],
    { revalidate: 300 }
  )();
}

/**
 * Fetches the user's connected (LinkedIn) accounts. Extracted from the page
 * components that all shared this exact mapping.
 */
export async function getConnectedAccounts(
  cookieHeader: string
): Promise<ConnectedAccount[]> {
  try {
    const response = await fetch(`${apiBase}/auth/connected-accounts`, {
      cache: "no-store",
      headers: { cookie: cookieHeader },
    });
    if (!response.ok) return [];

    const payload = (await response.json()) as ConnectedAccountsResponse;
    return (
      payload?.data?.map((account) => ({
        id: account._id,
        provider: account.provider,
        accessTokenExpiresAt: account.accessTokenExpiresAt,
        displayName: account.displayName,
        avatarUrl: account.avatarUrl,
        vanityName: account.vanityName ?? account.profileMetadata?.vanityName,
        headline: account.profileMetadata?.localizedHeadline,
        isActive: account.isActive,
      })) ?? []
    );
  } catch {
    return [];
  }
}
