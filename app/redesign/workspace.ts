import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import type { UserProfile } from "../lib/types";
import {
  getDashboardInitialData,
  getCachedSubscription,
  getCachedUser,
  getConnectedAccounts,
  getServerAuth,
} from "../lib/session";
import { getOnboardingState } from "../lib/onboarding";

export async function getWorkspaceProps(options: { includeDashboard?: boolean } = {}) {
  const { userId, sessionId } = await auth();
  if (!userId) redirect("/sign-in");

  const serverAuth = await getServerAuth();
  const cacheKey = sessionId ?? userId;
  const [onboarding, apiUser, subscription, connectedAccounts, initialDashboardData] = await Promise.all([
    getOnboardingState(serverAuth),
    getCachedUser(serverAuth, cacheKey),
    getCachedSubscription(serverAuth, cacheKey),
    getConnectedAccounts(serverAuth),
    options.includeDashboard ? getDashboardInitialData(serverAuth) : Promise.resolve(undefined),
  ]);

  if (
    onboarding.kind === "missing" ||
    onboarding.profile.isComplete !== true
  ) {
    redirect("/onboarding");
  }

  const name = apiUser?.name?.trim();
  const email = apiUser?.email?.trim();
  if (!name || !email) {
    throw new Error("Unable to load the completed user's profile");
  }

  const user: UserProfile = {
    name,
    email,
    avatar: apiUser?.avatar ?? undefined,
    tier: apiUser?.tier ?? undefined,
  };
  return {
    user,
    connectedAccounts,
    primaryAccountId: connectedAccounts[0]?.id,
    subscription,
    initialDashboardData,
  };
}
