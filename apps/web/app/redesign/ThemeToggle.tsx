"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

function getPreferredTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem("marquill-theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function ThemeToggle({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const theme = useSyncExternalStore(
    (onChange) => {
      window.addEventListener("marquill-theme-change", onChange);
      return () => window.removeEventListener("marquill-theme-change", onChange);
    },
    () => (document.documentElement.dataset.theme as Theme | undefined) ?? getPreferredTheme(),
    () => "light",
  );

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("marquill-theme", next);
    window.dispatchEvent(new Event("marquill-theme-change"));
  };

  const label = theme === "dark" ? "Light mode" : "Dark mode";

  return (
    <button type="button" className={`mq-theme-toggle ${className}`} onClick={toggle} aria-label={label} title={label}>
      {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      {!compact && <span>{label}</span>}
    </button>
  );
}
