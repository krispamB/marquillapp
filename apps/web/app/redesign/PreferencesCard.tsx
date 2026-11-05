"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { Globe2, Monitor, Moon, Palette, SlidersHorizontal, Sun } from "lucide-react";
import { API_BASE, jsonRequest, readApi } from "./api";
import { revalidateUserCache } from "../lib/actions";
import {
  applyThemePreference,
  formatTimezoneLabel,
  getBrowserTimezone,
  listTimezones,
  readStoredTheme,
  type ThemePreference,
  type UserPreferences,
} from "../lib/preferences";
import MarquillSelect from "../../components/ui/MarquillSelect";

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string; Icon: typeof Sun }> = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

const BROWSER_TIMEZONE = "";

const subscribeNever = () => () => {};

export default function PreferencesCard({ initialPreferences }: { initialPreferences?: UserPreferences }) {
  // Without a saved theme, show the one this device remembers (from before
  // themes were saved to the account) so the control matches the screen.
  const deviceTheme = useSyncExternalStore(subscribeNever, readStoredTheme, () => "system" as const);
  const browserTimezone = useSyncExternalStore(subscribeNever, getBrowserTimezone, () => "UTC");
  const timezones = useSyncExternalStore(subscribeNever, listTimezonesOnce, () => SERVER_TIMEZONES);

  const [theme, setTheme] = useState<ThemePreference | undefined>(initialPreferences?.theme);
  const [timezone, setTimezone] = useState<string | null>(initialPreferences?.timezone ?? null);
  const [saving, setSaving] = useState<"theme" | "timezone" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const effectiveTheme = theme ?? deviceTheme;
  const timezoneOptions = useMemo(
    () => (timezone && !timezones.includes(timezone) ? [timezone, ...timezones] : timezones),
    [timezone, timezones],
  );

  async function save(field: "theme" | "timezone", body: UserPreferences, revert: () => void) {
    setSaving(field);
    setError(null);
    try {
      await readApi(`${API_BASE}/users/me/preferences`, jsonRequest(body, { method: "PATCH" }));
      void revalidateUserCache();
    } catch (reason) {
      revert();
      setError(reason instanceof Error ? reason.message : "Unable to save your preference.");
    } finally {
      setSaving(null);
    }
  }

  function changeTheme(next: ThemePreference) {
    if (next === effectiveTheme && theme) return;
    const previous = theme;
    const previousApplied = effectiveTheme;
    setTheme(next);
    applyThemePreference(next);
    void save("theme", { theme: next }, () => {
      setTheme(previous);
      applyThemePreference(previousApplied);
    });
  }

  function changeTimezone(value: string) {
    const next = value === BROWSER_TIMEZONE ? null : value;
    if (next === timezone) return;
    const previous = timezone;
    setTimezone(next);
    void save("timezone", { timezone: next }, () => setTimezone(previous));
  }

  return (
    <div className="mq-card mq-settings-card">
      <div className="mq-card-heading">
        <span className="mq-title"><SlidersHorizontal size={16} /> Preferences</span>
        <span className="mq-mono">{saving ? "Saving…" : "Synced to your account"}</span>
      </div>
      {error ? <div className="mq-alert mq-alert-error mq-preference-error">{error}</div> : null}

      <div className="mq-preference-row">
        <span className="mq-preference-icon" aria-hidden="true"><Palette size={16} /></span>
        <span className="mq-preference-copy">
          <strong id="mq-pref-theme-label">Appearance</strong>
          <small>{effectiveTheme === "system" ? "Matches your device's light or dark setting." : `Always ${effectiveTheme}, on every device.`}</small>
        </span>
        <div className="mq-segmented mq-segmented-small" role="radiogroup" aria-labelledby="mq-pref-theme-label">
          {THEME_OPTIONS.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={effectiveTheme === value}
              className={effectiveTheme === value ? "is-active" : ""}
              onClick={() => changeTheme(value)}
              disabled={saving === "theme"}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mq-preference-row">
        <span className="mq-preference-icon" aria-hidden="true"><Globe2 size={16} /></span>
        <span className="mq-preference-copy">
          <strong>Timezone</strong>
          <small>
            {timezone
              ? formatTimezoneLabel(timezone)
              : `${formatTimezoneLabel(browserTimezone)} · from your browser`}
          </small>
        </span>
        <MarquillSelect
          className="mq-preference-select"
          ariaLabel="Timezone"
          value={timezone ?? BROWSER_TIMEZONE}
          onChange={changeTimezone}
          disabled={saving === "timezone"}
          options={[
            { value: BROWSER_TIMEZONE, label: "Use browser timezone" },
            ...timezoneOptions.map((zone) => ({ value: zone, label: formatTimezoneLabel(zone) })),
          ]}
        />
      </div>
    </div>
  );
}

const SERVER_TIMEZONES: string[] = [];
let cachedTimezones: string[] | null = null;
function listTimezonesOnce() {
  cachedTimezones ??= listTimezones();
  return cachedTimezones;
}
