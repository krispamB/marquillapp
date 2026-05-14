import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import OnboardingClient from "./OnboardingClient";

const API = process.env.NEXT_PUBLIC_API_BASE_URL;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OnboardingSession = { userType?: string; currentStep?: number; isComplete?: boolean; data?: Record<string, any> };

export default async function OnboardingPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.getAll().map(({ name, value }) => `${name}=${value}`).join("; ");

  let session: OnboardingSession | null = null;
  try {
    const res = await fetch(`${API}/onboarding`, {
      headers: { Cookie: cookieHeader },
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
