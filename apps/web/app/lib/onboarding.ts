import type { ServerAuth } from "./session";
import { authHeaders } from "./session";
import type { UserType } from "../onboarding/types";

const apiBase =
  process.env.BACKEND_API_URL ?? "http://localhost:3500/api/v1";

export type OnboardingApiStep = 1 | 2 | 3 | 4 | 5;

export type OnboardingProfile = {
  userType?: UserType;
  currentStep?: OnboardingApiStep;
  isComplete?: boolean;
  data?: Record<string, unknown>;
};

export type OnboardingState =
  | { kind: "missing" }
  | { kind: "profile"; profile: OnboardingProfile };

function isOnboardingApiStep(value: unknown): value is OnboardingApiStep {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5;
}

function isUserType(value: unknown): value is UserType {
  return value === "CREATOR" || value === "PRO_WRITER";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

  const body = (await response.json()) as { data?: Record<string, unknown> };
  const profile = body.data;
  if (!profile) {
    throw new Error("Onboarding response did not contain a profile");
  }

  if (profile.userType !== undefined && !isUserType(profile.userType)) {
    throw new Error("Onboarding response contained an invalid user type");
  }
  if (
    profile.currentStep !== undefined &&
    !isOnboardingApiStep(profile.currentStep)
  ) {
    throw new Error("Onboarding response contained an invalid current step");
  }
  if (
    profile.isComplete !== undefined &&
    typeof profile.isComplete !== "boolean"
  ) {
    throw new Error("Onboarding response contained an invalid completion state");
  }
  if (
    profile.data !== undefined &&
    !isRecord(profile.data)
  ) {
    throw new Error("Onboarding response contained invalid profile data");
  }

  const validatedProfile: OnboardingProfile = {
    ...(profile.userType !== undefined && { userType: profile.userType }),
    ...(profile.currentStep !== undefined && {
      currentStep: profile.currentStep,
    }),
    ...(profile.isComplete !== undefined && {
      isComplete: profile.isComplete,
    }),
    ...(profile.data !== undefined && {
      data: profile.data,
    }),
  };

  return { kind: "profile", profile: validatedProfile };
}
