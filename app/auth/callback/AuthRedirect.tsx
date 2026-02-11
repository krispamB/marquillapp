"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AuthRedirect({ hasEmail }: { hasEmail: boolean }) {
  const router = useRouter();

  useEffect(() => {
    const destination = hasEmail ? "/dashboard" : "/";
    const timer = window.setTimeout(() => {
      router.replace(destination);
    }, 1500);

    return () => window.clearTimeout(timer);
  }, [hasEmail, router]);

  return null;
}
