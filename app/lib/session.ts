import { unstable_cache } from "next/cache";
import type { UserApiResponse } from "./types";

const apiBase =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3500/api/v1";

export function getCachedUser(cookieHeader: string, accessToken: string) {
  return unstable_cache(
    async () => {
      const res = await fetch(`${apiBase}/users/me`, {
        headers: { cookie: cookieHeader },
      });
      if (!res.ok) return null;
      return res.json() as Promise<UserApiResponse>;
    },
    ["user-me", accessToken],
    { revalidate: 300 }
  )();
}

export function getCachedSubscription(cookieHeader: string, accessToken: string) {
  return unstable_cache(
    async () => {
      const res = await fetch(`${apiBase}/payment/subscription`, {
        headers: { cookie: cookieHeader },
      });
      if (!res.ok) return null;
      const body = await res.json();
      return (body?.tier ?? null) as { name: string; isDefault: boolean } | null;
    },
    ["subscription", accessToken],
    { revalidate: 300 }
  )();
}
