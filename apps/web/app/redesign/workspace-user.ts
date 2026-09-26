import type { UserProfile } from "../lib/types";

type ApiUser = Partial<UserProfile> | null | undefined;

type ClerkIdentity = {
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  imageUrl: string;
  primaryEmailAddressId: string | null;
  emailAddresses: Array<{ id: string; emailAddress: string }>;
};

function clean(value: string | null | undefined) {
  return value?.trim() || undefined;
}

export function resolveWorkspaceUser(
  apiUser: ApiUser,
  clerkUser?: ClerkIdentity | null,
  onboardingName?: string,
): UserProfile | null {
  const clerkName = clean(
    [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(" "),
  ) ?? clean(clerkUser?.username);
  const primaryEmail = clerkUser?.emailAddresses.find(
    (address) => address.id === clerkUser.primaryEmailAddressId,
  );
  const clerkEmail = clean(
    primaryEmail?.emailAddress ?? clerkUser?.emailAddresses[0]?.emailAddress,
  );

  const name = clean(apiUser?.name) ?? clerkName ?? clean(onboardingName);
  const email = clean(apiUser?.email) ?? clerkEmail;
  if (!name || !email) return null;

  return {
    name,
    email,
    avatar: clean(apiUser?.avatar) ?? clean(clerkUser?.imageUrl),
    tier: apiUser?.tier ?? undefined,
  };
}
