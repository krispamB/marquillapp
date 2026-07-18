import { unstable_cache } from "next/cache";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import {
  enrichDashboardPost,
  readAllPostPages,
  sortScheduledPosts,
} from "./dashboard";
import type {
  ConnectedAccount,
  ConnectedAccountsResponse,
  DashboardInitialData,
  DashboardPostsResponse,
  PaymentUsageResponse,
  PostComparisonResponse,
  PostDetailResponse,
  UserApiResponse,
} from "./types";

// Absolute backend URL for server-side fetches. The client uses the relative
// NEXT_PUBLIC_API_BASE_URL (= /api/v1) so requests proxy same-origin; on the
// server we call the backend directly.
const apiBase =
  process.env.BACKEND_API_URL ?? "http://localhost:3500/api/v1";

/**
 * Fresh Clerk credentials for server-side backend fetches.
 *
 * The `__session` cookie only lives 60 seconds, so forwarding it verbatim is
 * unreliable — an idle tab navigating in carries an expired cookie, the cause of
 * the "JWT is expired" failures. `getToken()` mints a current token via the
 * handshake the Clerk proxy middleware performs on navigation. We expose both a
 * Bearer token and a Cookie header whose `__session` value is overridden to that
 * fresh token, so the backend authenticates whether it reads the Authorization
 * header or the cookie. Other incoming cookies are preserved.
 */
export type ServerAuth = { token: string | null; cookie: string };

export async function getServerAuth(): Promise<ServerAuth> {
  const { getToken } = await auth();
  const token = await getToken();
  const store = await cookies();

  const parts = store
    .getAll()
    .map(({ name, value }) =>
      name === "__session" && token ? `__session=${token}` : `${name}=${value}`
    );
  if (token && !store.get("__session")) parts.push(`__session=${token}`);

  return { token, cookie: parts.join("; ") };
}

export function authHeaders({ token, cookie }: ServerAuth): HeadersInit {
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function readServerApi<T>(path: string, serverAuth: ServerAuth): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    cache: "no-store",
    headers: authHeaders(serverAuth),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Dashboard request failed with ${response.status}.`);
  }
  return (await response.json()) as T;
}

function previousUtcMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return date.toISOString().slice(0, 7);
}

export async function getDashboardInitialData(
  serverAuth: ServerAuth,
): Promise<DashboardInitialData> {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const previousMonth = previousUtcMonth(currentMonth);
  const comparisonQuery = new URLSearchParams({ currentMonth, previousMonth });

  const [usageResult, comparisonResult, postsResult] = await Promise.allSettled([
    readServerApi<PaymentUsageResponse>("/payment/usage", serverAuth),
    readServerApi<PostComparisonResponse>(
      `/posts/comparison?${comparisonQuery.toString()}`,
      serverAuth,
    ),
    readAllPostPages((page) =>
      readServerApi<DashboardPostsResponse>(
        `/posts?status=SCHEDULED&page=${page}`,
        serverAuth,
      )),
  ]);

  const errors: string[] = [];
  if (usageResult.status === "rejected") errors.push("usage");
  if (comparisonResult.status === "rejected") errors.push("post comparison");
  if (postsResult.status === "rejected") errors.push("scheduled posts");

  const scheduledPosts = postsResult.status === "fulfilled"
    ? sortScheduledPosts(postsResult.value).slice(0, 3)
    : [];

  const details = await Promise.all(
    scheduledPosts.map(async (post) => {
      try {
        return await readServerApi<PostDetailResponse>(`/posts/${post._id}`, serverAuth);
      } catch {
        return undefined;
      }
    }),
  );

  return {
    usage: usageResult.status === "fulfilled" ? usageResult.value.data ?? null : null,
    comparison:
      comparisonResult.status === "fulfilled" ? comparisonResult.value.data ?? null : null,
    scheduledPosts: scheduledPosts.map((post, index) =>
      enrichDashboardPost(post, details[index]?.data)),
    errors,
  };
}

export function getPostDetail(serverAuth: ServerAuth, postId: string) {
  return readServerApi<PostDetailResponse>(
    `/posts/${encodeURIComponent(postId)}`,
    serverAuth,
  );
}

export function getCachedUser(serverAuth: ServerAuth, cacheKey: string) {
  const readUser = unstable_cache(
    async () => {
      const res = await fetch(`${apiBase}/users/me`, {
        headers: authHeaders(serverAuth),
      });
      if (!res.ok) {
        throw new Error(`User profile request failed with ${res.status}.`);
      }
      return (await res.json()) as UserApiResponse;
    },
    ["user-me", cacheKey],
    // Tagged so onboarding can bust this cache on completion (see
    // revalidateUserCache); without it a freshly-onboarded user would keep
    // reading the stale empty profile and bounce back to /onboarding.
    { revalidate: 300, tags: ["user-me"] }
  );

  // Cache successful profiles, but not transient failures. A rejected cached
  // function is retried on the next request instead of poisoning the session's
  // profile cache with `null` for five minutes.
  return readUser().catch(() => null);
}

export function getCachedSubscription(serverAuth: ServerAuth, cacheKey: string) {
  return unstable_cache(
    async () => {
      try {
        const res = await fetch(`${apiBase}/payment/subscription`, {
          headers: authHeaders(serverAuth),
        });
        if (!res.ok) return null;
        const body = await res.json();
        return (body?.tier ?? null) as {
          name: string;
          isDefault: boolean;
        } | null;
      } catch {
        return null;
      }
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
  serverAuth: ServerAuth
): Promise<ConnectedAccount[]> {
  try {
    const response = await fetch(`${apiBase}/auth/connected-accounts`, {
      cache: "no-store",
      headers: authHeaders(serverAuth),
    });
    if (!response.ok) return [];

    const payload = (await response.json()) as ConnectedAccountsResponse;
    return (
      payload?.data?.map((account) => ({
        id: account._id,
        provider: account.provider,
        accountType: account.accountType,
        accessTokenExpiresAt: account.accessTokenExpiresAt,
        displayName: account.displayName,
        avatarUrl: account.avatarUrl ?? account.profileMetadata?.picture,
        vanityName: account.vanityName ?? account.profileMetadata?.vanityName,
        headline: account.profileMetadata?.localizedHeadline,
        profile: account.profileMetadata,
        isActive: account.isActive,
      })) ?? []
    );
  } catch {
    return [];
  }
}
