import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import type { UserProfile } from "../lib/types";
import {
  getCachedSubscription,
  getCachedUser,
  getConnectedAccounts,
  getServerAuth,
} from "../lib/session";

export async function getWorkspaceProps() {
  const { userId, sessionId } = await auth();
  if (!userId) redirect("/sign-in");

  const serverAuth = await getServerAuth();
  const cacheKey = sessionId ?? userId;
  const [apiUser, subscription] = await Promise.all([
    getCachedUser(serverAuth, cacheKey),
    getCachedSubscription(serverAuth, cacheKey),
  ]);

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
