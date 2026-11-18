"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchOverview, formatCompact, isAnalyticsOff, overviewCache } from "./analytics";
import type { AnalyticsOverview, ConnectedAccount } from "../lib/types";

/** The figures in the dropdown are always the default range, whatever the panel shows. */
const SNAPSHOT_RANGE = "28d";
/** A failed account is not asked again for this long, so hovering the menu never hammers a down API. */
const RETRY_AFTER_MS = 30_000;

export type AccountSnapshot =
  | { status: "loading" }
  | { status: "ok"; followers: number | null; impressions: number | null }
  | { status: "off" }
  | { status: "reconnect_required" }
  | { status: "not_admin" }
  | { status: "unavailable" };

type Settled = { signature: string; at: number; snapshot: AccountSnapshot };

const snapshotKey = (accountId: string) => `${accountId}:${SNAPSHOT_RANGE}`;
/** Changes when a reconnect or a new analytics grant makes an earlier answer obsolete. */
const signatureOf = (account: ConnectedAccount) =>
  `${account.id}|${account.accessTokenExpiresAt ?? ""}|${account.analyticsExpiresAt ?? ""}`;

export function snapshotFromOverview(overview: AnalyticsOverview): AccountSnapshot {
  switch (overview.access) {
    case "ok":
      return {
        status: "ok",
        followers: overview.followers?.total ?? null,
        impressions: overview.metrics?.impressions?.value ?? null,
      };
    case "missing_scope":
      return { status: "off" };
    case "reconnect_required":
    case "not_admin":
    case "unavailable":
      return { status: overview.access };
  }
}

/** The one-line description under an account in the dropdown, or null for none. */
export function describeSnapshot(snapshot: AccountSnapshot | undefined): string | null {
  if (!snapshot) return null;
  switch (snapshot.status) {
    case "loading":
      return "Loading…";
    case "off":
      return "Analytics off";
    case "reconnect_required":
      return "Reconnect needed";
    case "not_admin":
      return "No longer an admin";
    case "unavailable":
      return null;
    case "ok": {
      const parts: string[] = [];
      if (snapshot.followers !== null) parts.push(`${formatCompact(snapshot.followers)} followers`);
      if (snapshot.impressions !== null) parts.push(`${formatCompact(snapshot.impressions)} impressions, 28 days`);
      return parts.length ? parts.join(" · ") : null;
    }
  }
}

/**
 * Light 28-day figures for every connected account, loaded on demand (when the
 * account menu is about to open), never on page load. `load` is cheap to call
 * repeatedly: accounts already known, cached or in flight are skipped.
 */
export function useAccountSnapshots(accounts: ConnectedAccount[]) {
  const [settled, setSettled] = useState<Record<string, Settled>>({});
  const settledRef = useRef(settled);
  const accountsRef = useRef(accounts);
  const inFlight = useRef(new Map<string, string>());
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    accountsRef.current = accounts;
    settledRef.current = settled;
  });

  useEffect(() => {
    const controller = new AbortController();
    const pending = inFlight.current;
    controllerRef.current = controller;
    return () => {
      controller.abort();
      pending.clear();
    };
  }, []);

  const load = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller || controller.signal.aborted) return;
    const now = Date.now();
    for (const account of accountsRef.current) {
      if (isAnalyticsOff(account, now)) continue;
      if (overviewCache.get(snapshotKey(account.id), now)) continue;
      const signature = signatureOf(account);
      if (inFlight.current.get(account.id) === signature) continue;
      const known = settledRef.current[account.id];
      if (known && known.signature === signature) {
        const failed = known.snapshot.status === "unavailable";
        if (!failed || now - known.at < RETRY_AFTER_MS) continue;
      }

      inFlight.current.set(account.id, signature);
      const settle = (snapshot: AccountSnapshot) => {
        if (controller.signal.aborted) return;
        if (inFlight.current.get(account.id) === signature) inFlight.current.delete(account.id);
        setSettled((current) => ({ ...current, [account.id]: { signature, at: Date.now(), snapshot } }));
      };
      setSettled((current) => ({
        ...current,
        [account.id]: { signature, at: now, snapshot: { status: "loading" } },
      }));
      fetchOverview(account.id, SNAPSHOT_RANGE, false, controller.signal)
        .then((overview) => {
          if (controller.signal.aborted) return;
          overviewCache.set(snapshotKey(account.id), overview);
          settle(snapshotFromOverview(overview));
        })
        .catch(() => settle({ status: "unavailable" }));
    }
  }, []);

  const snapshots: Record<string, AccountSnapshot> = {};
  for (const account of accounts) {
    if (isAnalyticsOff(account)) {
      snapshots[account.id] = { status: "off" };
      continue;
    }
    const cached = overviewCache.get(snapshotKey(account.id));
    if (cached) {
      snapshots[account.id] = snapshotFromOverview(cached);
      continue;
    }
    const known = settled[account.id];
    if (known && known.signature === signatureOf(account)) snapshots[account.id] = known.snapshot;
  }

  return { snapshots, load };
}
