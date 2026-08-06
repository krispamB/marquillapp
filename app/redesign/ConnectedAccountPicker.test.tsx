import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import type { ConnectedAccount } from "../lib/types";

mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

const {
  default: ConnectedAccountPicker,
  activeConnectedAccounts,
  resolveAttachAccountChoice,
} = await import("./ConnectedAccountPicker");

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

  test("resolves zero, one, and multiple active-account paths", () => {
    expect(resolveAttachAccountChoice([]).kind).toBe("none");

    const single = resolveAttachAccountChoice([accounts[0]]);
    expect(single.kind).toBe("single");
    expect(single.kind === "single" ? single.account.id : null).toBe("personal-1");

    expect(resolveAttachAccountChoice(accounts).kind).toBe("choose");
    expect(resolveAttachAccountChoice([
      accounts[0],
      { ...accounts[1], isActive: false },
    ]).kind).toBe("single");
  });

  test("shows the connection state instead of account confirmation when none are active", () => {
    const view = render(
      <ConnectedAccountPicker
        isOpen
        accounts={[]}
        isCreating={false}
        onClose={() => {}}
        onConfirm={() => {
          throw new Error("No account should be confirmed.");
        }}
      />,
    );

    expect(view.getByRole("button", { name: "Connect LinkedIn" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "Continue to post" })).toBeNull();
  });

  test("supports Escape dismissal but locks the dialog while creating", () => {
    let closeCount = 0;
    const view = render(
      <ConnectedAccountPicker
        isOpen
        accounts={accounts}
        isCreating={false}
        onClose={() => { closeCount += 1; }}
        onConfirm={() => {}}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(closeCount).toBe(1);

    view.rerender(
      <ConnectedAccountPicker
        isOpen
        accounts={accounts}
        isCreating
        onClose={() => { closeCount += 1; }}
        onConfirm={() => {}}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });

    expect(closeCount).toBe(1);
    expect(view.getByRole("button", { name: "Creating draft…" }).hasAttribute("disabled")).toBe(true);
  });
});
