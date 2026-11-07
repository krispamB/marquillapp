"use client";

import { useEffect } from "react";
import {
  THEME_CHANGE_EVENT,
  applyThemePreference,
  isThemePreference,
  readStoredTheme,
  resolveTheme,
  type ThemePreference,
} from "../lib/preferences";
import { API_BASE, readApi } from "./api";

// One client-side lookup per page load is enough; the server snapshot covers
// every later navigation once the profile request succeeds.
let accountThemeLookup: Promise<ThemePreference | undefined> | null = null;

function lookUpAccountTheme() {
  accountThemeLookup ??= readApi<{ preferences?: { theme?: unknown } }>(`${API_BASE}/users/me`)
    .then((user) => (isThemePreference(user?.preferences?.theme) ? user.preferences.theme : undefined))
    .catch(() => {
      accountThemeLookup = null; // let the next mount try again
      return undefined;
    });
  return accountThemeLookup;
}

/**
 * Brings this device in line with the theme saved on the user's account, and
 * keeps a "system" theme following the OS colour scheme while the page is open.
 *
 * `preference` comes from the server-rendered profile. When a signed-in page
 * renders without it (the profile request failed, as it can right after a
 * sign-in on a new browser), the account theme is fetched here instead, so the
 * user doesn't have to reload to see it. With no saved preference anywhere,
 * the device's own remembered theme, or the system theme, is kept.
 */
export default function ThemePreferenceSync({
  preference,
  signedIn = false,
}: {
  preference?: ThemePreference;
  signedIn?: boolean;
}) {
  useEffect(() => {
    if (preference) {
      if (preference !== readStoredTheme()) applyThemePreference(preference);
      return;
    }
    if (!signedIn) return;

    // A theme picked while the lookup is in flight wins over the lookup.
    let stale = false;
    const markStale = () => { stale = true; };
    window.addEventListener(THEME_CHANGE_EVENT, markStale);
    void lookUpAccountTheme().then((theme) => {
      if (!stale && theme && theme !== readStoredTheme()) applyThemePreference(theme);
    });
    return () => {
      stale = true;
      window.removeEventListener(THEME_CHANGE_EVENT, markStale);
    };
  }, [preference, signedIn]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => {
      if (readStoredTheme() === "system") {
        document.documentElement.dataset.theme = resolveTheme("system");
        window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
      }
    };
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, []);

  return null;
}
