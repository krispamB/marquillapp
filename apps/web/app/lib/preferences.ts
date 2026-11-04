export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export type UserPreferences = {
  theme?: ThemePreference;
  /** IANA name; missing or null means "use the browser's timezone". */
  timezone?: string | null;
};

/**
 * The theme is also cached in localStorage under this key, so the inline
 * script in app/layout.tsx can paint the right theme before React loads.
 */
export const THEME_STORAGE_KEY = "marquill-theme";
export const THEME_CHANGE_EVENT = "marquill-theme-change";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function readStoredTheme(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemePreference(stored)) return stored;
  } catch {
    // Storage blocked; fall through to the system theme.
  }
  return "system";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== "system") return preference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Paints `preference` on this device and remembers it for the next load. */
export function applyThemePreference(preference: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage blocked; the theme still applies for this page view.
  }
  document.documentElement.dataset.theme = resolveTheme(preference);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function listTimezones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
  try {
    const zones = intl.supportedValuesOf?.("timeZone");
    if (zones?.length) return zones.includes("UTC") ? zones : ["UTC", ...zones];
  } catch {
    // Older engines; the browser's own zone is still offered.
  }
  return ["UTC"];
}

/** "GMT+1", "GMT-5:30", or "GMT" for the zone at `at`. */
export function formatTimezoneOffset(timeZone: string, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
      .formatToParts(at)
      .find((item) => item.type === "timeZoneName");
    // Some ICU builds say "GMT+0" for zero offset where browsers say "GMT".
    return part?.value && part.value !== "GMT+0" ? part.value : "GMT";
  } catch {
    return "GMT";
  }
}

export function formatTimezoneLabel(timeZone: string): string {
  return `${timeZone.replace(/_/g, " ")} (${formatTimezoneOffset(timeZone)})`;
}
