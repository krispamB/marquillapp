import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { ConnectedAccount } from "../lib/types";
import ConnectedAccountPicker, {
  activeConnectedAccounts,
} from "./ConnectedAccountPicker";

GlobalRegistrator.register();
afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const accounts: ConnectedAccount[] = [
  {
    id: "personal-1",
    provider: "LINKEDIN",
    accountType: "PERSONAL",
    displayName: "Ada Lovelace",
    isActive: true,
  },
  {
    id: "organization-1",
    provider: "LINKEDIN",
    accountType: "ORGANIZATION",
    displayName: "Analytical Engines",
    isActive: true,
  },
];

describe("ConnectedAccountPicker", () => {
  test("requires an explicit selection before confirming an account", () => {
    let confirmedAccount = "";
    const view = render(
      <ConnectedAccountPicker
        isOpen
        accounts={accounts}
        isCreating={false}
        onClose={() => {}}
        onConfirm={(accountId) => { confirmedAccount = accountId; }}
      />,
    );
    const continueButton = view.getByRole("button", { name: "Continue to post" });

    expect(continueButton.hasAttribute("disabled")).toBe(true);
    expect(confirmedAccount).toBe("");

    fireEvent.click(view.getByRole("button", { name: /Analytical Engines/ }));
    expect(continueButton.hasAttribute("disabled")).toBe(false);

    fireEvent.click(continueButton);
    expect(confirmedAccount).toBe("organization-1");
  });

  test("excludes explicitly inactive accounts", () => {
    expect(activeConnectedAccounts([
      ...accounts,
      {
        id: "inactive-1",
        provider: "LINKEDIN",
        displayName: "Expired account",
        isActive: false,
      },
    ]).map((account) => account.id)).toEqual(["personal-1", "organization-1"]);
  });
});
