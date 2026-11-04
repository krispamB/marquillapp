"use client";

import { useEffect } from "react";
import {
  THEME_CHANGE_EVENT,
  applyThemePreference,
  readStoredTheme,
  resolveTheme,
  type ThemePreference,
} from "../lib/preferences";

/**
 * Brings this device in line with the theme saved on the user's account, and
 * keeps a "system" theme following the OS colour scheme while the page is open.
 * Without a saved preference, the device's own remembered theme is kept.
 */
export default function ThemePreferenceSync({ preference }: { preference?: ThemePreference }) {
  useEffect(() => {
    if (preference && preference !== readStoredTheme()) applyThemePreference(preference);
  }, [preference]);

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
