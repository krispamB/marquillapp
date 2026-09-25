"use server";

import { updateTag } from "next/cache";

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
