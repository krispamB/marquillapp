import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  AnalyticsAudience,
  AnalyticsOverview,
  AnalyticsPostsResponse,
  ConnectedAccount,
} from "../lib/types";

mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
mock.module("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const responses = new Map<string, unknown>();
const requested: string[] = [];
const realFetch = globalThis.fetch;
function stubFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "http://x").pathname;
    requested.push(path);
    const key = [...responses.keys()].find((candidate) => path.endsWith(candidate));
    if (!key) return new Response(JSON.stringify({ message: "nope" }), { status: 500 });
    return new Response(JSON.stringify({ statusCode: 200, data: responses.get(key) }), { status: 200 });
  }) as typeof fetch;
}

const { default: AnalyticsPanel } = await import("./AnalyticsPanel");
const { clearAnalyticsCaches } = await import("./analytics");

GlobalRegistrator.register();
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => {
  responses.clear();
  requested.length = 0;
  stubFetch();
  clearAnalyticsCaches();
});

const range = { key: "28d" as const, days: 28, start: "2026-10-14", end: "2026-11-10", previousStart: "2026-09-16", previousEnd: "2026-10-13" };
const metric = (value: number, changePct: number | null = null, previous: number | null = null) => ({ value, previous, changePct });

function makeOverview(type: "PERSON" | "ORGANIZATION", access: AnalyticsOverview["access"] = "ok"): AnalyticsOverview {
  const person = type === "PERSON";
  const ok = access === "ok";
  return {
    account: { id: "acc", accountType: type, displayName: "Ada Lovelace", avatarUrl: null },
    access,
    range,
    fetchedAt: new Date().toISOString(),
    cached: false,
    followers: ok ? { total: 4821, gained: metric(96, 35.2) } : { total: null, gained: null },
    metrics: ok
      ? {
          impressions: metric(18340, 21.4), reactions: metric(412), comments: metric(58, -4.9), reposts: metric(14),
          engagementRate: metric(2.6, -10.3, 2.9), membersReached: person ? metric(9120) : null,
          uniqueImpressions: person ? null : metric(7000), clicks: person ? null : metric(100), pageViews: person ? null : metric(300),
        }
      : { impressions: null, reactions: null, comments: null, reposts: null, engagementRate: null, membersReached: null, uniqueImpressions: null, clicks: null, pageViews: null },
    series: ok
      ? Array.from({ length: 28 }, (_, index) => ({
          date: `2026-10-${String(14 + (index % 17)).padStart(2, "0")}`,
          impressions: index === 3 ? null : 100 + index, reactions: 1, comments: 1, reposts: person ? 0 : 1,
          followersGained: index > 25 && !person ? null : 2, clicks: person ? null : 1, pageViews: person ? null : 2,
        }))
      : [],
    unavailable: [],
  };
}

const postsResponse = (posts: AnalyticsPostsResponse["posts"], coverage: AnalyticsPostsResponse["coverage"] = "marquill_posts"): AnalyticsPostsResponse => ({
  access: "ok", range, fetchedAt: new Date().toISOString(), cached: false, coverage, truncated: false, posts,
});
const audienceResponse: AnalyticsAudience = {
  access: "ok", supported: true, fetchedAt: new Date().toISOString(), cached: false, totalFollowers: 4821,
  facets: [{ key: "seniority", label: "Seniority", items: [{ label: "Senior", count: 1620, share: 33.6 }] }],
};

const account = (type: "PERSONAL" | "ORGANIZATION" = "PERSONAL"): ConnectedAccount => ({
  id: "acc", provider: "LINKEDIN", accountType: type, displayName: "Ada Lovelace", isActive: true,
  analyticsExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
});
const analyticsOff = (): ConnectedAccount => ({ ...account(), analyticsExpiresAt: undefined });

function mount(accounts = [account()], props: Partial<React.ComponentProps<typeof AnalyticsPanel>> = {}) {
  return render(<AnalyticsPanel connectedAccounts={accounts} selectedAccountId="acc" {...props} />);
}
const analyticsCalls = () => requested.filter((path) => /\/(overview|posts|audience)$/.test(path));

describe("AnalyticsPanel", () => {
  test("renders a personal account's tiles, chart, posts and audience", async () => {
    responses.set("/overview", makeOverview("PERSON"));
    responses.set("/posts", postsResponse([
      { urn: "u1", postId: "p1", text: "Shipping day", publishedAt: "2026-10-20T08:00:00.000Z", url: "https://linkedin.com/u1", impressions: 5210, reactions: 133, comments: 21, reposts: null, clicks: null, engagementRate: 3 },
    ]));
    responses.set("/audience", audienceResponse);
    const view = mount();
    await view.findByText("Members reached");
    expect(view.getByText("▲ 21.4%")).toBeTruthy();
    expect(view.getByText("+96")).toBeTruthy();
    expect(view.getByText("4,821 followers now").getAttribute("title")).toBe("4,821 followers now.");
    expect(view.getByText("Compared with the previous 28 days")).toBeTruthy();
    expect(view.getByText("vs previous 28 days", { selector: ".mq-analytics-meta *" })).toBeTruthy();
    expect(view.getByText("Reactions, comments, reposts").getAttribute("title")).toBe("Reactions, comments and reposts ÷ impressions");
    expect(view.getByText("655 a day on average")).toBeTruthy();
    expect(view.getByText("Unique people")).toBeTruthy();
    expect(view.getByText("▼ 0.3 pts")).toBeTruthy();
    expect(view.getByLabelText("up 21.4% vs previous 28 days")).toBeTruthy();
    expect(view.getByText("All current followers, by count and share. Not limited to the selected range.")).toBeTruthy();
    expect(view.getByText("18.3K")).toBeTruthy();
    expect(view.queryByText("Page views")).toBeNull();
    expect(view.getByRole("img", { name: /per day/ })).toBeTruthy();
    await view.findAllByText("Shipping day");
    expect(view.getByText(/^Only posts published with Marquill\./)).toBeTruthy();
    expect(view.getAllByText("Shipping day")[0].getAttribute("href")).toBe("https://linkedin.com/u1");
    expect(view.getAllByText("Edit in Marquill")[0].getAttribute("href")).toBe("/posts/p1/edit");
    expect(view.getAllByText("Engagement rate").length).toBeGreaterThan(1);
    expect(view.queryByText("Clicks")).toBeNull();
    await view.findByText("Seniority");
    expect(view.getByText("1,620 · 33.6%")).toBeTruthy();
  });

  test("small audience facets lead with the count and a whole-number share", async () => {
    responses.set("/overview", makeOverview("PERSON"));
    responses.set("/posts", postsResponse([]));
    responses.set("/audience", {
      ...audienceResponse,
      facets: [{ key: "seniority", label: "Seniority", items: [
        { label: "Senior", count: 3, share: 42.857 },
        { label: "Entry", count: 1, share: 14.3 },
      ] }],
    });
    const view = mount();
    await view.findByText("Seniority");
    expect(view.getByText("3 · 43%")).toBeTruthy();
    expect(view.getByText("3 followers, 43%")).toBeTruthy();
    expect(view.getByText("1 follower, 14%")).toBeTruthy();
    expect(view.getByText("3 · 43%").parentElement?.getAttribute("title")).toBe("3 followers, 43%");
  });

  test("renders no chip when there is no previous data", async () => {
    const data = makeOverview("PERSON");
    data.metrics.impressions = metric(72);
    data.metrics.comments = metric(0);
    data.metrics.engagementRate = metric(2.6);
    data.followers = { total: 9, gained: metric(1) };
    responses.set("/overview", data);
    responses.set("/posts", postsResponse([]));
    responses.set("/audience", { ...audienceResponse, supported: false, facets: [] });
    const { container, findByText } = mount();
    await findByText("Members reached");
    expect(container.querySelector('.mq-analytics-chip[role="img"]')).toBeNull();
    expect(container.querySelector(".mq-analytics-meta")?.textContent).toContain("No earlier period to compare");
    expect(container.querySelector(".mq-analytics-tiles")?.textContent).not.toContain("—");
  });

  test("a decline is not styled as an error", async () => {
    responses.set("/overview", makeOverview("PERSON"));
    responses.set("/posts", postsResponse([]));
    responses.set("/audience", audienceResponse);
    const view = mount();
    await view.findByText("Members reached");
    expect(view.getByText("▼ 4.9%").closest(".mq-analytics-chip")?.className).toContain("is-down");
  });

  test("a small sample shows a neutral chip next to the rate and a short note", async () => {
    const overview = makeOverview("PERSON");
    overview.metrics.impressions = metric(40, 10);
    responses.set("/overview", overview);
    responses.set("/posts", postsResponse([]));
    responses.set("/audience", audienceResponse);
    const view = mount();
    await view.findByText("Members reached");
    const chip = view.getByText("Small sample");
    expect(chip.className).toBe("mq-analytics-chip");
    expect(chip.getAttribute("title")).toBe("Fewer than 100 impressions in this period, so the rate can swing widely.");
    expect(chip.parentElement?.querySelector("strong")?.textContent).toBe("2.6%");
    expect(view.getByText("Reactions, comments, reposts")).toBeTruthy();
    expect(view.queryByText("▼ 0.3 pts")).toBeNull();
  });

  test("renders organization tiles and the follower lag footnote", async () => {
    responses.set("/overview", makeOverview("ORGANIZATION"));
    responses.set("/posts", postsResponse([], "all_posts"));
    responses.set("/audience", audienceResponse);
    const view = mount([account("ORGANIZATION")]);
    await view.findByText("Unique impressions");
    expect(view.getByText("Clicks")).toBeTruthy();
    expect(view.getAllByText("Page views").length).toBeGreaterThan(1);
    expect(view.queryByText("Members reached")).toBeNull();
    expect(view.getByText((_, node) => node?.className.includes("mq-stat-note") === true && node.textContent === "4,821 followers now · last 2 days not reported yet")).toBeTruthy();
    expect(view.getByText("last 2 days").className).toBe("mq-nowrap");
    expect(view.getByText("Includes clicks")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "New followers" }));
    expect(view.getByText("LinkedIn has not published follower figures for the last 2 days yet.")).toBeTruthy();
  });

  test("an account known to be off shows the off card and makes no analytics request", async () => {
    responses.set("/overview", makeOverview("PERSON"));
    const view = mount([analyticsOff()], { fallback: <p>Up next here</p> });
    expect(view.getByRole("status").textContent).toContain("Analytics is off for Ada Lovelace");
    expect(view.getByText("LinkedIn shares a personal profile's numbers only after a separate permission. Posting and scheduling keep working without it.")).toBeTruthy();
    expect(view.getByText("Impressions and engagement rate, day by day")).toBeTruthy();
    expect(view.getByText("New followers")).toBeTruthy();
    expect(view.getByText("How each post published with Marquill performed")).toBeTruthy();
    const action = view.getByRole("button", { name: "Turn on analytics" });
    expect(action.className).toBe("mq-primary-button");
    expect(view.getByText("Up next here")).toBeTruthy();
    expect(view.queryByRole("group", { name: "Date range" })).toBeNull();
    expect(view.getByRole("heading", { level: 1 }).textContent).toBe("Ada Lovelace");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(requested).toHaveLength(0);
  });

  test("a missing_scope overview shows the off card with the fallback, and posts and audience are not fetched again after it", async () => {
    responses.set("/overview", makeOverview("PERSON", "missing_scope"));
    responses.set("/posts", postsResponse([]));
    responses.set("/audience", audienceResponse);
    const view = mount([account()], { fallback: <p>Up next here</p> });
    await view.findByText("Analytics is off for Ada Lovelace");
    expect(view.getByRole("button", { name: "Turn on analytics" })).toBeTruthy();
    expect(view.getByText("Up next here")).toBeTruthy();
    expect(view.queryByText("Impressions")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 30));
    // Overview, posts and audience start together; none of them is requested a second time.
    expect(analyticsCalls().filter((path) => path.endsWith("/overview"))).toHaveLength(1);
    expect(analyticsCalls().filter((path) => path.endsWith("/posts")).length).toBeLessThanOrEqual(1);
    expect(analyticsCalls().filter((path) => path.endsWith("/audience")).length).toBeLessThanOrEqual(1);
    expect(view.queryByText("Top posts")).toBeNull();
  });

  test("reconnect_required asks to reconnect", async () => {
    responses.set("/overview", makeOverview("PERSON", "reconnect_required"));
    const view = mount([account()], { fallback: <p>Up next here</p> });
    await view.findByText("Reconnect Ada Lovelace");
    expect(view.getByText("LinkedIn stopped accepting this connection, so its numbers can't be read.")).toBeTruthy();
    expect(view.getByRole("button", { name: "Reconnect LinkedIn" }).className).toBe("mq-primary-button");
    expect(view.getByText("Up next here")).toBeTruthy();
  });

  test("not_admin offers Check again and hides the range control", async () => {
    responses.set("/overview", makeOverview("ORGANIZATION", "not_admin"));
    const view = mount([account("ORGANIZATION")]);
    await view.findByText("You're no longer an admin of Ada Lovelace");
    expect(view.getByText("LinkedIn only shares a page's numbers with its admins. Ask a page admin to add you back, then check again.")).toBeTruthy();
    expect(view.getByRole("button", { name: "Check again" }).className).toBe("mq-secondary-button");
    expect(view.queryByRole("group", { name: "Date range" })).toBeNull();
    expect(view.queryByRole("button", { name: "Refresh analytics" })).toBeNull();
    expect(view.container.querySelector(".mq-alert")).toBeNull();
  });

  test("an unavailable overview offers Try again", async () => {
    responses.set("/overview", makeOverview("PERSON", "unavailable"));
    const view = mount();
    await view.findByText("LinkedIn isn't responding");
    expect(view.getByText("Nothing is wrong with your account. Try again in a minute.")).toBeTruthy();
    expect(view.getByRole("button", { name: "Try again" }).className).toBe("mq-secondary-button");
    expect(view.getByRole("status")).toBeTruthy();
  });

  test("shows the empty top-posts state", async () => {
    responses.set("/overview", makeOverview("PERSON"));
    responses.set("/posts", postsResponse([]));
    responses.set("/audience", { ...audienceResponse, supported: false, facets: [] });
    const view = mount();
    await view.findByText("No posts were published in this period.");
    expect(view.getByRole("link", { name: "Create a post" }).getAttribute("href")).toBe("/posts/new");
    await waitFor(() => expect(view.queryByText("Audience")).toBeNull());
  });

  test("a failed overview shows one retry control and no heading controls", async () => {
    const view = mount();
    await view.findByText("LinkedIn isn't responding");
    expect(view.queryByRole("button", { name: "Refresh analytics" })).toBeNull();
    expect(view.queryByRole("group", { name: "Date range" })).toBeNull();
  });

  test("the heading names the account and carries the range and refresh controls", async () => {
    responses.set("/overview", makeOverview("PERSON"));
    responses.set("/posts", postsResponse([]));
    responses.set("/audience", audienceResponse);
    const view = mount();
    await view.findByText("Members reached");
    expect(view.getByRole("heading", { level: 1 }).textContent).toBe("Ada Lovelace");
    expect(view.container.querySelector(".mq-analytics-meta")?.textContent).toContain("Personal profile · ");
    expect(view.getByRole("group", { name: "Date range" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Refresh analytics" })).toBeTruthy();
    expect(view.container.querySelector(".mq-analytics-meta .mq-nowrap")?.textContent).toBe("Updated just now");
  });

  test("the chart tooltip names the metric with the value", async () => {
    responses.set("/overview", makeOverview("PERSON"));
    responses.set("/posts", postsResponse([]));
    responses.set("/audience", audienceResponse);
    const view = mount();
    await view.findByText("Members reached");
    const chart = view.container.querySelector(".mq-analytics-chart") as HTMLElement;
    expect(chart.getAttribute("aria-label")).toBeNull();
    const hint = chart.getAttribute("aria-describedby") as string;
    expect(chart.querySelector(`[id="${hint}"]`)?.textContent).toBe("Use the arrow keys to move between days.");
    fireEvent.keyDown(chart, { key: "Home" });
    expect(chart.querySelector(".mq-analytics-tip")?.textContent).toMatch(/ · 100 impressions$/);
    fireEvent.click(view.getByRole("button", { name: "New followers" }));
    fireEvent.keyDown(chart, { key: "Home" });
    expect(chart.querySelector(".mq-analytics-tip")?.textContent).toMatch(/ · 2 new followers$/);
  });

  test("a failed audience request on a page offers Try again; a personal account shows nothing", async () => {
    responses.set("/overview", makeOverview("ORGANIZATION"));
    responses.set("/posts", postsResponse([], "all_posts"));
    const page = mount([account("ORGANIZATION")]);
    const card = await page.findByRole("region", { name: "Audience" });
    expect(within(card).getByText("Audience could not be loaded.")).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Try again" })).toBeTruthy();
    cleanup();
    clearAnalyticsCaches();
    responses.set("/overview", makeOverview("PERSON"));
    const personal = mount();
    await personal.findByText("Members reached");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(personal.queryByRole("region", { name: "Audience" })).toBeNull();
  });

  test("the above-100% explanation is a footnote shown only when a post is above 100%", async () => {
    const post = (rate: number) => ({ urn: "u1", postId: "p9", text: "Tiny post", publishedAt: "2026-10-20T08:00:00.000Z", url: "https://linkedin.com/p9", impressions: 5, reactions: 1, comments: 0, reposts: 0, clicks: null, engagementRate: rate });
    responses.set("/overview", makeOverview("PERSON"));
    responses.set("/audience", audienceResponse);
    responses.set("/posts", postsResponse([post(140)]));
    const over = mount();
    await over.findByText("A rate above 100% means more engagements than impressions, which happens on a small post.");
    expect(over.queryByText(/can pass 100%/)).toBeNull();
    cleanup();
    clearAnalyticsCaches();
    responses.set("/posts", postsResponse([post(40)]));
    const under = mount();
    await under.findAllByText("Tiny post");
    expect(under.queryByText(/A rate above 100%/)).toBeNull();
  });

  test("a failed request shows the retry card as an alert", async () => {
    const view = mount();
    await view.findByText("LinkedIn isn't responding");
    expect(view.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(view.getByRole("alert")).toBeTruthy();
  });

  test("the range change is reported to the page", async () => {
    responses.set("/overview", makeOverview("PERSON"));
    responses.set("/posts", postsResponse([]));
    responses.set("/audience", audienceResponse);
    const seen: string[] = [];
    const view = mount([account()], { onRangeChange: (next) => seen.push(next) });
    await view.findByText("Members reached");
    fireEvent.click(view.getByRole("button", { name: "90 days" }));
    expect(seen).toEqual(["90d"]);
  });

  test("turning analytics on starts the requests once the account carries a grant", async () => {
    responses.set("/overview", makeOverview("PERSON"));
    responses.set("/posts", postsResponse([]));
    responses.set("/audience", audienceResponse);
    const view = mount([analyticsOff()]);
    expect(requested).toHaveLength(0);
    view.rerender(<AnalyticsPanel connectedAccounts={[account()]} selectedAccountId="acc" />);
    await view.findByText("Members reached");
    expect(analyticsCalls().length).toBeGreaterThan(0);
  });
});
