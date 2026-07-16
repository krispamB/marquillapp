import type { ServerAuth } from "./session";
import { authHeaders } from "./session";

const apiBase =
  process.env.BACKEND_API_URL ?? "http://localhost:3500/api/v1";

export type OnboardingProfile = {
  userType?: string;
  currentStep?: number;
  isComplete?: boolean;
  data?: Record<string, unknown>;
};

export type OnboardingState =
  | { kind: "missing" }
  | { kind: "profile"; profile: OnboardingProfile };

/**
 * The onboarding endpoint is the source of truth for route decisions.
 * A 404 is an expected state for a new user; other failures are not treated as
 * a missing profile because doing so would incorrectly restart onboarding.
 */
export async function getOnboardingState(
  serverAuth: ServerAuth
): Promise<OnboardingState> {
  const response = await fetch(`${apiBase}/onboarding`, {
    headers: authHeaders(serverAuth),
    cache: "no-store",
  });

  if (response.status === 404) return { kind: "missing" };

  if (!response.ok) {
    throw new Error(`Unable to fetch onboarding profile (${response.status})`);
  }

  const body = (await response.json()) as { data?: OnboardingProfile };
  if (!body.data) {
    throw new Error("Onboarding response did not contain a profile");
  }

  return { kind: "profile", profile: body.data };
}
