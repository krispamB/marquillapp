"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_BASE_URL;

export default function AuthRedirect({ hasEmail }: { hasEmail: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!hasEmail) {
      router.replace("/");
      return;
    }

    fetch(`${API}/onboarding`, { credentials: "include" })
      .then(res => (res.ok ? res.json() : null))
      .then(session => {
        router.replace(session?.isComplete ? "/dashboard" : "/onboarding");
      })
      .catch(() => {
        router.replace("/onboarding");
      });
  }, [hasEmail, router]);

  return null;
}
