import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import DashboardClient from "./DashboardClient";
import type { UserProfile } from "../lib/types";
import {
  getCachedUser,
  getCachedSubscription,
  getConnectedAccounts,
  getServerCookieHeader,
} from "../lib/session";

export default async function DashboardPage() {
  const { userId, sessionId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  const cacheKey = sessionId ?? userId;
  const cookieHeader = await getServerCookieHeader();

  const [apiUser, subscription] = await Promise.all([
    getCachedUser(cookieHeader, cacheKey),
    getCachedSubscription(cookieHeader, cacheKey),
  ]);

  const name = apiUser?.name?.trim();
  const email = apiUser?.email?.trim();
  if (!name || !email) {
    redirect("/onboarding");
  }

  const user: UserProfile = {
    name,
    email,
    avatar: apiUser?.avatar ?? undefined,
    tier: apiUser?.tier ?? undefined,
  };

  const connectedAccounts = await getConnectedAccounts(cookieHeader);
  const primaryAccountId = connectedAccounts[0]?.id;

  return (
    <DashboardClient
      user={user}
      connectedAccounts={connectedAccounts}
      primaryAccountId={primaryAccountId}
      subscription={subscription}
    />
  );
}
