import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import OnboardingClient from "./OnboardingClient";
import { getServerAuth, authHeaders } from "../lib/session";

const API = process.env.BACKEND_API_URL ?? "http://localhost:3500/api/v1";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OnboardingSession = { userType?: string; currentStep?: number; isComplete?: boolean; data?: Record<string, any> };

export default async function OnboardingPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  const serverAuth = await getServerAuth();

  let session: OnboardingSession | null = null;
  try {
    const res = await fetch(`${API}/onboarding`, {
      headers: authHeaders(serverAuth),
      cache: "no-store",
    });
    if (res.ok) {
      const body = await res.json();
      session = body.data ?? null;
    }
  } catch {}

  if (session?.isComplete) redirect("/dashboard");

  return <OnboardingClient initialSession={session} />;
}
