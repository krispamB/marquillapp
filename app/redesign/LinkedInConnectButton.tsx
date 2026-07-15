"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { API_BASE, readApi } from "./api";

type LinkedInAuthResponse = { data?: string };

interface LinkedInConnectButtonProps {
  children: ReactNode;
  className?: string;
  title?: string;
  "aria-label"?: string;
}

/** Starts the reusable LinkedIn OAuth flow, then refreshes workspace data. */
export default function LinkedInConnectButton({
  children,
  className,
  title,
  "aria-label": ariaLabel,
}: LinkedInConnectButtonProps) {
  const router = useRouter();
  const watcherRef = useRef<number | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function clearWatcher() {
    if (watcherRef.current !== null) {
      window.clearInterval(watcherRef.current);
      watcherRef.current = null;
    }
  }

  useEffect(() => clearWatcher, []);

  async function connectLinkedIn() {
    if (isConnecting) return;

    const width = 560;
    const height = 700;
    const left = Math.max(0, Math.floor(window.screenX + (window.outerWidth - width) / 2));
    const top = Math.max(0, Math.floor(window.screenY + (window.outerHeight - height) / 2));
    const popup = window.open(
      "",
      "marquill-linkedin-auth",
      `width=${width},height=${height},left=${left},top=${top},popup=yes,resizable=yes,scrollbars=yes`,
    );

    if (!popup) {
      setError("Popup was blocked. Please allow popups and try again.");
      return;
    }

    setError(null);
    setIsConnecting(true);
    try {
      const response = await readApi<LinkedInAuthResponse>(`${API_BASE}/auth/linkedin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!response?.data) throw new Error("Unable to start the LinkedIn connection.");

      popup.location.href = response.data;
      clearWatcher();
      watcherRef.current = window.setInterval(() => {
        if (!popup.closed) return;
        clearWatcher();
        setIsConnecting(false);
        router.refresh();
      }, 500);
    } catch (reason) {
      if (!popup.closed) popup.close();
      setIsConnecting(false);
      setError(reason instanceof Error ? reason.message : "Unable to connect LinkedIn.");
    }
  }

  return (
    <>
      <button
        type="button"
        className={className}
        title={title}
        aria-label={ariaLabel}
        aria-busy={isConnecting}
        disabled={isConnecting}
        onClick={() => void connectLinkedIn()}
      >
        {children}
      </button>
      {error ? <p className="mq-connect-error" role="alert">{error}</p> : null}
    </>
  );
}
