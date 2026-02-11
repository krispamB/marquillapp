"use client";

import { Lock, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

const BRAND_WORDMARK =
  "https://res.cloudinary.com/dnpvndlmy/image/upload/v1770689074/marquill/logo_bpw55v.svg";

export default function Home() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authEndpoint = useMemo(() => {
    const base =
      process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3500/api/v1";
    const endpoint =
      process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENDPOINT ?? "/auth/google";
    return `${base}${endpoint}`;
  }, []);

  const handleGoogleSignIn = async () => {
    setError(null);
    setIsLoading(true);

    try {
      window.location.href = authEndpoint;
    } catch (err) {
      setIsLoading(false);
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--color-background)]">
      <div className="pointer-events-none absolute left-1/2 top-12 h-72 w-72 -translate-x-1/2 rounded-full bg-[var(--color-primary)]/10 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-20 left-12 h-52 w-52 rounded-full bg-[var(--color-accent)]/15 blur-[110px]" />
      <div className="pointer-events-none absolute right-16 top-24 h-40 w-40 rounded-full bg-[var(--color-secondary)]/10 blur-[90px]" />

      <main className="relative flex min-h-screen items-center justify-center px-6 py-16">
        <div className="flex w-full max-w-xl flex-col items-center text-center">
          <div className="mt-8 w-full rounded-3xl border border-[var(--color-border)] bg-[var(--color-overlay)] p-6 text-left shadow-[0_30px_80px_-55px_rgba(15,23,42,0.45)] sm:p-8">
            <div className="flex flex-col items-center text-center">
              <img src={BRAND_WORDMARK} alt="Marquill" className="h-8 w-auto" />
              <p className="mt-4 text-sm text-[var(--color-text-secondary)] sm:text-base">
                Stay consistent on LinkedIn with AI-backed research and scheduling.
              </p>
              <h2 className="mt-6 text-2xl font-semibold text-[var(--color-text-primary)]">
                Sign In
              </h2>
              <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                Use Google to continue.
              </p>
            </div>

            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isLoading}
              className="mt-8 flex w-full items-center justify-center gap-3 rounded-2xl border border-[var(--color-border)] bg-white px-4 py-3 text-sm font-semibold text-[var(--color-secondary)] shadow-[0_18px_40px_-32px_rgba(15,23,42,0.45)] transition duration-300 hover:-translate-y-0.5 hover:border-transparent hover:bg-[var(--color-secondary)] hover:text-white disabled:cursor-not-allowed disabled:opacity-70"
            >
              <span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--color-background)]">
                <img
                  src="https://res.cloudinary.com/dnpvndlmy/image/upload/v1770762428/marquill/Google_Symbol_2_lyg02p.webp"
                  alt="Google"
                  className="h-4 w-4"
                />
              </span>
              <span>{isLoading ? "Connecting..." : "Continue with Google"}</span>
            </button>

            {error ? (
              <p className="mt-4 text-sm font-medium text-red-600">{error}</p>
            ) : null}

            <div className="mt-6 rounded-2xl border border-[var(--color-border-inset)] bg-white/80 px-4 py-3 text-xs text-[var(--color-text-secondary)]">
              Google only for now. Email/password login will be available soon.
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-xs text-[var(--color-text-secondary)]">
            <div className="flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white/80 px-3 py-2">
              <ShieldCheck className="h-3.5 w-3.5 text-[var(--color-primary)]" />
              <span>Secure OAuth</span>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white/80 px-3 py-2">
              <Lock className="h-3.5 w-3.5 text-[var(--color-primary)]" />
              <span>No passwords stored</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
