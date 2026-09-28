"use server";

import { auth } from "@clerk/nextjs/server";
import { updateTag } from "next/cache";
import { subscriptionCacheTag } from "./session";

/**
 * Invalidates the cached `/users/me` response (see getCachedUser in session.ts).
 * Called when onboarding completes so the dashboard re-reads the now-complete
 * profile instead of the stale empty one cached during sign-up. `updateTag`
 * (vs `revalidateTag`) gives read-your-writes: the next dashboard load sees the
 * fresh profile immediately rather than the stale value.
 */
export async function revalidateUserCache() {
  updateTag("user-me");
}

/**
 * Invalidates the caller's cached plan (see getCachedSubscription in
 * session.ts) and their `/users/me` profile, which also carries a tier. Called
 * by the billing page once a completed checkout shows up in the backend, so the
 * page and shell render the new plan without waiting for the cache to expire.
 */
export async function revalidateSubscriptionCache() {
  const { userId } = await auth();
  if (!userId) return;
  updateTag(subscriptionCacheTag(userId));
  updateTag("user-me");
}
