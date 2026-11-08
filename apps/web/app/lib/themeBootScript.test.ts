import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";

GlobalRegistrator.register();

const { THEME_BOOT_SCRIPT, THEME_STORAGE_KEY } = await import("./preferences");

const runBootScript = () => new Function(THEME_BOOT_SCRIPT)();
const flushObservers = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

describe("theme boot script", () => {
  test("paints the remembered theme", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    runBootScript();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  test("puts the theme back when <html> loses its attributes", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    runBootScript();

    // What React does to <html> when the root layout mounts on the client.
    const html = document.documentElement;
    while (html.attributes.length) html.removeAttributeNode(html.attributes[0]);
    await flushObservers();

    expect(html.dataset.theme).toBe("dark");
  });

  test("leaves a theme someone else set alone", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    runBootScript();

    document.documentElement.dataset.theme = "light";
    await flushObservers();

    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
