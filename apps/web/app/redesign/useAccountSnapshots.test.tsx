import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AnalyticsOverview, ConnectedAccount } from "../lib/types";

GlobalRegistrator.register();
const { useAccountSnapshots, describeSnapshot } = await import("./useAccountSnapshots");
const { clearAnalyticsCaches, overviewCache } = await import("./analytics");

const realFetch = globalThis.fetch;
const requested: string[] = [];
const failing = new Set<string>();
let overviewBy: Record<string, Partial<AnalyticsOverview> & { followersTotal?: number | null; impressions?: number | null }> = {};

beforeEach(() => {
  requested.length = 0;
  failing.clear();
  overviewBy = {};
  clearAnalyticsCaches();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "http://x").pathname;
    requested.push(path);
    const id = decodeURIComponent(path.split("/accounts/")[1].split("/")[0]);
    if (failing.has(id)) return new Response("{}", { status: 500 });
    const spec = overviewBy[id] ?? {};
    const access = spec.access ?? "ok";
    const body = {
      account: { id }, access, followers: { total: spec.followersTotal ?? 4821, gained: null },
      metrics: { impressions: spec.impressions === null ? null : { value: spec.impressions ?? 18340, previous: null, changePct: null } },
      series: [], range: { key: "28d" }, fetchedAt: new Date().toISOString(),
    };
    return new Response(JSON.stringify({ statusCode: 200, data: body }), { status: 200 });
  }) as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});
afterAll(() => GlobalRegistrator.unregister());

const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
const on = (id: string, extra: Partial<ConnectedAccount> = {}): ConnectedAccount => ({
  id, provider: "LINKEDIN", accountType: "PERSONAL", displayName: id, analyticsExpiresAt: future, ...extra,
});

describe("describeSnapshot", () => {
  test("states the 28-day range next to impressions", () => {
    expect(describeSnapshot({ status: "ok", followers: 4821, impressions: 18340 })).toBe("4,821 followers · 18.3K impressions, 28 days");
    expect(describeSnapshot({ status: "ok", followers: null, impressions: 18340 })).toBe("18.3K impressions, 28 days");
    expect(describeSnapshot({ status: "ok", followers: 4821, impressions: null })).toBe("4,821 followers");
    expect(describeSnapshot({ status: "ok", followers: null, impressions: null })).toBeNull();
  });
  test("names each non-ok state, and says nothing for a failure", () => {
    expect(describeSnapshot({ status: "loading" })).toBe("Loading…");
    expect(describeSnapshot({ status: "off" })).toBe("Analytics off");
    expect(describeSnapshot({ status: "reconnect_required" })).toBe("Reconnect needed");
    expect(describeSnapshot({ status: "not_admin" })).toBe("No longer an admin");
    expect(describeSnapshot({ status: "unavailable" })).toBeNull();
    expect(describeSnapshot(undefined)).toBeNull();
  });
});

describe("useAccountSnapshots", () => {
  test("loads each account once, in parallel, fills the shared cache, and skips accounts known to be off", async () => {
    const accounts = [on("a"), on("b"), { ...on("c"), analyticsExpiresAt: undefined }];
    const { result } = renderHook(() => useAccountSnapshots(accounts));
    expect(result.current.snapshots.c).toEqual({ status: "off" });
    expect(result.current.snapshots.a).toBeUndefined();
    act(() => { result.current.load(); result.current.load(); result.current.load(); });
    expect(result.current.snapshots.a).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current.snapshots.a?.status).toBe("ok"));
    await waitFor(() => expect(result.current.snapshots.b?.status).toBe("ok"));
    expect(result.current.snapshots.a).toEqual({ status: "ok", followers: 4821, impressions: 18340 });
    expect(requested.sort()).toEqual([
      expect.stringContaining("/accounts/a/overview"),
      expect.stringContaining("/accounts/b/overview"),
    ] as never);
    expect(overviewCache.get("a:28d")).toBeTruthy();
    act(() => result.current.load());
    expect(requested).toHaveLength(2);
  });

  test("uses the cache the panel already filled instead of asking again", async () => {
    const cached = { account: { id: "a" }, access: "ok", followers: { total: 10, gained: null }, metrics: { impressions: { value: 5, previous: null, changePct: null } } } as unknown as AnalyticsOverview;
    overviewCache.set("a:28d", cached);
    const { result } = renderHook(() => useAccountSnapshots([on("a")]));
    expect(result.current.snapshots.a).toEqual({ status: "ok", followers: 10, impressions: 5 });
    act(() => result.current.load());
    expect(requested).toHaveLength(0);
  });

  test("one failure does not affect the others, non-ok access is kept per account, and a failure is not retried at once", async () => {
    failing.add("b");
    overviewBy.c = { access: "reconnect_required" };
    const { result } = renderHook(() => useAccountSnapshots([on("a"), on("b"), on("c")]));
    act(() => result.current.load());
    await waitFor(() => {
      expect(result.current.snapshots.a?.status).toBe("ok");
      expect(result.current.snapshots.b?.status).toBe("unavailable");
      expect(result.current.snapshots.c?.status).toBe("reconnect_required");
    });
    expect(overviewCache.get("c:28d")).toBeUndefined();
    const before = requested.length;
    act(() => result.current.load());
    expect(requested).toHaveLength(before);
  });
});
