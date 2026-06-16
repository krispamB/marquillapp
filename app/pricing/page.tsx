import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import type { UserProfile } from "../lib/types";
import {
  getCachedUser,
  getCachedSubscription,
  getConnectedAccounts,
  getServerCookieHeader,
} from "../lib/session";
import PricingClient from "./PricingClient";

export default async function PricingPage() {
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
    id: apiUser?._id,
    name,
    email,
    avatar: apiUser?.avatar ?? undefined,
    tier: apiUser?.tier ?? undefined,
  };

  const connectedAccounts = await getConnectedAccounts(cookieHeader);
  const primaryAccountId = connectedAccounts[0]?.id;

  return (
    <PricingClient
      user={user}
      connectedAccounts={connectedAccounts}
      primaryAccountId={primaryAccountId}
      subscription={subscription}
    />
  );
}
