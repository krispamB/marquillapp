import type { ReactNode } from "react";

const BRAND_WORDMARK =
  "https://res.cloudinary.com/dnpvndlmy/image/upload/q_auto/f_auto/v1775561659/marquill/logo_nwvdon.svg";

// Branded background used by the sign-in / sign-up pages.
export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--color-background)]">
      <div className="pointer-events-none absolute left-1/2 top-12 h-72 w-72 -translate-x-1/2 rounded-full bg-[var(--color-primary)]/10 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-20 left-12 h-52 w-52 rounded-full bg-[var(--color-accent)]/15 blur-[110px]" />
      <div className="pointer-events-none absolute right-16 top-24 h-40 w-40 rounded-full bg-[var(--color-secondary)]/10 blur-[90px]" />

      <main className="relative flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-16">
        <div className="flex flex-col items-center text-center">
          <img src={BRAND_WORDMARK} alt="Marquill" className="h-8 w-auto" />
          <p className="mt-4 max-w-sm text-sm text-[var(--color-text-secondary)]">
            Stay consistent on LinkedIn with AI-backed research and scheduling.
          </p>
        </div>
        {children}
      </main>
    </div>
  );
}
