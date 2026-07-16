import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import type { UserProfile } from "../lib/types";
import {
  getCachedSubscription,
  getCachedUser,
  getConnectedAccounts,
  getServerAuth,
} from "../lib/session";
import { getOnboardingState } from "../lib/onboarding";

export async function getWorkspaceProps() {
  const { userId, sessionId } = await auth();
  if (!userId) redirect("/sign-in");

  const serverAuth = await getServerAuth();
  const cacheKey = sessionId ?? userId;
  const [onboarding, apiUser, subscription] = await Promise.all([
    getOnboardingState(serverAuth),
    getCachedUser(serverAuth, cacheKey),
    getCachedSubscription(serverAuth, cacheKey),
  ]);

  if (
    onboarding.kind === "missing" ||
    onboarding.profile.isComplete !== true
  ) {
    redirect("/onboarding");
  }

  const name = apiUser?.name?.trim();
  const email = apiUser?.email?.trim();
  if (!name || !email) redirect("/onboarding");

  const user: UserProfile = {
    name,
    email,
    avatar: apiUser?.avatar ?? undefined,
    tier: apiUser?.tier ?? undefined,
  };
  const connectedAccounts = await getConnectedAccounts(serverAuth);

  return {
    user,
    connectedAccounts,
    primaryAccountId: connectedAccounts[0]?.id,
    subscription,
  };
}
