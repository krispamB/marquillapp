import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import OnboardingClient from "./OnboardingClient";
import { getServerAuth } from "../lib/session";
import { getOnboardingState } from "../lib/onboarding";

export default async function OnboardingPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  const serverAuth = await getServerAuth();
  const onboarding = await getOnboardingState(serverAuth);
  const session = onboarding.kind === "profile" ? onboarding.profile : null;

  if (session?.isComplete === true) redirect("/dashboard");

  return <OnboardingClient initialSession={session} />;
}
