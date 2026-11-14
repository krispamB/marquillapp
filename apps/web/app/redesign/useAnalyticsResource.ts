"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalyticsCache } from "./analytics";

type Result<T> = { key: string; group: string; nonce: number; data?: T; failed?: boolean };

/**
 * Loads one analytics resource. `key` identifies the exact request (account +
 * range); `group` identifies what may stay on screen, dimmed, while a new key
 * loads (the account, so a range change keeps data but an account change does not).
 * Responses for a stale key are ignored, and in-flight requests are aborted.
 */
export function useAnalyticsResource<T extends { access: string }>({
  key,
  group,
  cache,
  load,
}: {
  key: string | null;
  group: string;
  cache: AnalyticsCache<T>;
  load: (refresh: boolean, signal: AbortSignal) => Promise<T>;
}) {
  const [result, setResult] = useState<Result<T> | null>(null);
  const [nonce, setNonce] = useState(0);
  const [reloadKey, setReloadKey] = useState<string | null>(null);
  const forceRef = useRef(false);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    if (!key) return;
    const force = forceRef.current;
    forceRef.current = false;
    if (!force && cache.get(key)) return;
    const controller = new AbortController();
    loadRef
      .current(force, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        cache.set(key, data);
        setResult({ key, group, nonce, data });
      })
      .catch((reason) => {
        if (controller.signal.aborted || (reason instanceof DOMException && reason.name === "AbortError")) return;
        setResult({ key, group, nonce, failed: true });
      });
    return () => controller.abort();
  }, [key, group, nonce, cache]);

  const reload = useCallback(() => {
    forceRef.current = true;
    setReloadKey(key);
    setNonce((value) => value + 1);
  }, [key]);

  const cached = key ? cache.get(key) : undefined;
  const current = result && result.key === key ? result : null;
  const data = (current && !current.failed ? current.data : undefined) ?? cached;
  const stale = !data && result && result.group === group && !result.failed ? result.data : undefined;
  const failed = !data && Boolean(current?.failed);
  const refreshing = Boolean(key) && reloadKey === key && (current?.nonce ?? -1) < nonce;
  const loading = Boolean(key) && !data && !failed;

  return { data: data ?? stale, isStale: !data && Boolean(stale), loading, failed, refreshing, reload };
}
