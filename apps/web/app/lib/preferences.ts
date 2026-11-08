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

/**
 * Inline <head> script (app/layout.tsx): paints the remembered theme before
 * React loads, and puts it back whenever `data-theme` disappears from <html>.
 *
 * It has to put it back because React strips every attribute it doesn't render
 * from <html> when the root layout mounts on the client rather than hydrating,
 * as it can on the client-side navigation after sign-in. The theme is saved, but
 * the page would stay light until a reload re-ran this script.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var d=document.documentElement;var paint=function(){var t;try{t=localStorage.getItem('${THEME_STORAGE_KEY}')}catch(e){}if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';d.dataset.theme=t};paint();new MutationObserver(function(){if(!d.dataset.theme)paint()}).observe(d,{attributes:true,attributeFilter:['data-theme']})}catch(e){}})()`;

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
