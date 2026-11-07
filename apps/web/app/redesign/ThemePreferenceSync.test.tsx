import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

GlobalRegistrator.register();

const { default: ThemePreferenceSync } = await import("./ThemePreferenceSync");
const { THEME_STORAGE_KEY } = await import("../lib/preferences");

const realFetch = globalThis.fetch;
let fetchMock = mock(async () => Response.json({}));

beforeEach(() => {
  // A new browser: nothing remembered, an OS in dark mode.
  window.localStorage.clear();
  document.documentElement.dataset.theme = "dark";
  fetchMock = mock(async () => Response.json({ preferences: { theme: "light" } }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});
afterAll(() => GlobalRegistrator.unregister());

// The account lookup is cached for the page load, so the test that fetches runs last.
describe("ThemePreferenceSync", () => {
  test("applies the server-rendered account theme without fetching", () => {
    render(<ThemePreferenceSync preference="light" signedIn />);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("keeps the system theme on signed-out pages", () => {
    render(<ThemePreferenceSync />);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("fetches the account theme when the server snapshot has none", async () => {
    render(<ThemePreferenceSync signedIn />);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
