import type { ReactNode } from "react";
import MarquillLockup from "../components/brand/MarquillLockup";
import ThemePreferenceSync from "./redesign/ThemePreferenceSync";

// Branded background used by the sign-in / sign-up pages. Colours come from the
// .mq-auth tokens in globals.css, which follow the page's data-theme.
export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="mq-auth relative overflow-hidden">
      {/* No account yet, so no saved preference: this only keeps a "system"
          theme following the OS while the page is open. */}
      <ThemePreferenceSync />
      <div className="pointer-events-none absolute left-1/2 top-12 h-72 w-72 -translate-x-1/2 rounded-full bg-[var(--auth-accent)]/10 blur-[120px]" />

      <main className="relative flex min-h-svh flex-col items-center justify-center gap-6 px-6 py-16">
        <div className="flex flex-col items-center text-center">
          <MarquillLockup size={32} theme="auto" />
          <p className="mt-4 max-w-sm text-sm text-[var(--auth-ink-500)]">
            Stay consistent on LinkedIn with AI-backed research and scheduling.
          </p>
        </div>
        {children}
      </main>
    </div>
  );
}
