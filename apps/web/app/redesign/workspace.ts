import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import {
  getDashboardInitialData,
  getCachedSubscription,
  getCachedUser,
  getConnectedAccounts,
  getServerAuth,
} from "../lib/session";
import { getOnboardingState } from "../lib/onboarding";
import { resolveWorkspaceUser } from "./workspace-user";

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

  const hasApiIdentity = Boolean(apiUser?.name?.trim() && apiUser?.email?.trim());
  const clerkUser = hasApiIdentity ? null : await currentUser();
  const onboardingName = onboarding.profile.data?.name;
  const user = resolveWorkspaceUser(
    apiUser,
    clerkUser,
    typeof onboardingName === "string" ? onboardingName : undefined,
  );
  if (!user) {
    throw new Error("Unable to load the completed user's profile");
  }
  return {
    user,
    connectedAccounts,
    primaryAccountId: connectedAccounts[0]?.id,
    subscription,
    initialDashboardData,
  };
}
