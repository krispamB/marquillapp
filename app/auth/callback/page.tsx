import { cookies } from "next/headers";
import AuthRedirect from "./AuthRedirect";

export default async function AuthCallbackPage() {
  const cookieStore = await cookies();
  const userCookie = cookieStore.get("user")?.value;

  let email: string | null = null;
  if (userCookie) {
    try {
      const parsed = JSON.parse(userCookie) as { email?: string };
      const value = parsed?.email?.trim();
      email = value && value.length > 0 ? value : null;
    } catch {
      email = null;
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--color-background)]">
      <div className="pointer-events-none absolute left-1/2 top-12 h-72 w-72 -translate-x-1/2 rounded-full bg-[var(--color-primary)]/10 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-24 left-8 h-52 w-52 rounded-full bg-[var(--color-accent)]/15 blur-[110px]" />

      <main className="relative flex min-h-screen items-center justify-center px-6 py-16">
        <div className="w-full max-w-md rounded-3xl border border-[var(--color-border)] bg-[var(--color-overlay)] p-8 text-center shadow-[0_30px_80px_-55px_rgba(15,23,42,0.45)]">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
            Signing in
          </p>
          <h1 className="mt-4 font-[var(--font-sora)] text-2xl font-semibold text-[var(--color-text-primary)]">
            {email ? `${email} signing in` : "Signing in..."}
          </h1>
          <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
            We’re getting your account ready.
          </p>
          <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-white/70">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-[var(--color-primary)]/70" />
          </div>
        </div>
      </main>

      <AuthRedirect hasEmail={Boolean(email)} />
    </div>
  );
}
