"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AuthRedirect({ hasEmail }: { hasEmail: boolean }) {
  const router = useRouter();

  useEffect(() => {
    router.replace(hasEmail ? "/onboarding" : "/");
  }, [hasEmail, router]);

  return null;
}
