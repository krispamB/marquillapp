import { describe, expect, test } from "bun:test";
import { resolveWorkspaceUser } from "./workspace-user";

describe("resolveWorkspaceUser", () => {
  test("falls back to Clerk identity when the backend user cannot be loaded", () => {
    expect(
      resolveWorkspaceUser(null, {
        firstName: "Ada",
        lastName: "Lovelace",
        username: null,
        imageUrl: "https://example.com/ada.jpg",
        primaryEmailAddressId: "email-primary",
        emailAddresses: [
          { id: "email-primary", emailAddress: "ada@example.com" },
        ],
      }),
    ).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
      avatar: "https://example.com/ada.jpg",
      tier: undefined,
    });
  });

  test("keeps backend subscription data while filling missing identity fields", () => {
    const tier = {
      _id: "tier-pro",
      name: "Pro",
      monthlyPrice: 20,
      yearlyPrice: 200,
      isDefault: false,
      isActive: true,
    };

    expect(
      resolveWorkspaceUser(
        { name: "Backend Name", email: "", avatar: "", tier },
        {
          firstName: "Clerk",
          lastName: "Name",
          username: null,
          imageUrl: "https://example.com/clerk.jpg",
          primaryEmailAddressId: "email-primary",
          emailAddresses: [
            { id: "email-primary", emailAddress: "clerk@example.com" },
          ],
        },
      ),
    ).toEqual({
      name: "Backend Name",
      email: "clerk@example.com",
      avatar: "https://example.com/clerk.jpg",
      tier,
    });
  });

  test("uses the completed onboarding name for an email-only Clerk account", () => {
    expect(
      resolveWorkspaceUser(
        null,
        {
          firstName: null,
          lastName: null,
          username: null,
          imageUrl: "https://example.com/avatar.jpg",
          primaryEmailAddressId: "email-primary",
          emailAddresses: [
            { id: "email-primary", emailAddress: "writer@example.com" },
          ],
        },
        "Onboarding Writer",
      ),
    ).toEqual({
      name: "Onboarding Writer",
      email: "writer@example.com",
      avatar: "https://example.com/avatar.jpg",
      tier: undefined,
    });
  });
});
