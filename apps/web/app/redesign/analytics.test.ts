import { describe, expect, test } from "bun:test";
import type { AnalyticsOverview, AnalyticsPost, AnalyticsSeriesPoint } from "../lib/types";
import {
  AnalyticsCache,
  areaPath,
  buildKpiTiles,
  chartMetricsFor,
  chartScale,
  engagementsOf,
  engagementRateNote,
  formatChange,
  formatPointsChange,
  hasComparison,
  NO_COMPARISON,
  trailingFollowerLagDays,
  formatComparison,
  formatGain,
  formatCompact,
  formatUpdated,
  formatUtcDate,
  followerLagFootnote,
  hasTrailingFollowerLag,
  POST_COLUMNS,
  postValueLabel,
  indexAtX,
  isAnalyticsOff,
  labelIndices,
  layoutPoints,
  linePath,
  parseAnalyticsRange,
  pointSegments,
  postsCoverageNote,
  RATE_OVER_100_NOTE,
  formatRangeVs,
  metricNoun,
  formatAudienceValue,
  seriesValues,
  sortPosts,
  sumValues,
  visiblePostColumns,
} from "./analytics";

const metric = (value: number, changePct: number | null = null) => ({ value, previous: null, changePct });

function overview(type: "PERSON" | "ORGANIZATION", extra: Partial<AnalyticsOverview> = {}): AnalyticsOverview {
  const person = type === "PERSON";
  return {
    account: { id: "a", accountType: type, displayName: "Ada", avatarUrl: null },
    access: "ok",
    range: { key: "28d", days: 28, start: "2026-10-14", end: "2026-11-10", previousStart: "", previousEnd: "" },
    fetchedAt: "2026-11-11T09:00:00.000Z",
    cached: false,
    followers: { total: 4821, gained: metric(96, 35.2) },
    metrics: {
      impressions: metric(18340, 21.4),
      reactions: metric(412),
      comments: metric(58),
      reposts: metric(14),
      engagementRate: metric(2.6),
      membersReached: person ? metric(9120) : null,
      uniqueImpressions: person ? null : metric(7000),
      clicks: person ? null : metric(100),
      pageViews: person ? null : metric(300),
    },
    series: [],
    unavailable: [],
    ...extra,
  };
}

describe("formatting", () => {
  test("compact only above 10K", () => {
    expect(formatCompact(9120)).toBe("9,120");
    expect(formatCompact(18340)).toBe("18.3K");
    expect(formatCompact(1_250_000)).toBe("1.3M");
  });

  test("change chip", () => {
    expect(formatChange(21.4)).toEqual({ direction: "up", label: "▲ 21.4%" });
    expect(formatChange(-4.9)).toEqual({ direction: "down", label: "▼ 4.9%" });
    expect(formatChange(null)).toEqual({ direction: "none", label: "" });
    expect(formatChange(undefined).direction).toBe("none");
    expect(formatChange(0).direction).toBe("flat");
  });

  test("UTC dates never shift a day", () => {
    expect(formatUtcDate("2026-10-14")).toBe("Oct 14");
    expect(formatUtcDate("2026-11-01")).toBe("Nov 1");
    expect(formatUtcDate("2026-10-20T00:30:00.000Z")).toBe("Oct 20");
  });

  test("updated label", () => {
    const now = new Date("2026-11-11T09:12:00.000Z").getTime();
    expect(formatUpdated("2026-11-11T09:00:00.000Z", now)).toBe("Updated 12 min ago");
    expect(formatUpdated("2026-11-11T09:11:50.000Z", now)).toBe("Updated just now");
    expect(formatUpdated("2026-11-11T06:00:00.000Z", now)).toBe("Updated 3 h ago");
  });

  test("range parsing falls back to 28d", () => {
    expect(parseAnalyticsRange("7d")).toBe("7d");
    expect(parseAnalyticsRange("bogus")).toBe("28d");
    expect(parseAnalyticsRange(undefined)).toBe("28d");
  });
});

describe("tiles", () => {
  test("person lead row and compact strip", () => {
    const { lead, more } = buildKpiTiles(overview("PERSON"));
    expect(lead.map((tile) => tile.key)).toEqual(["impressions", "engagementRate", "followers", "membersReached"]);
    expect(more.map((tile) => tile.key)).toEqual(["reactions", "comments", "reposts"]);
    const rate = lead.find((tile) => tile.key === "engagementRate");
    expect(rate?.note).toBe("Reactions, comments, reposts");
    expect(rate?.noteTitle).toBe("Reactions, comments and reposts ÷ impressions");
    expect(rate?.change).toBe("points");
  });

  test("New followers leads with the period gain and notes the total", () => {
    const followers = buildKpiTiles(overview("PERSON")).lead.find((tile) => tile.key === "followers");
    expect(followers?.label).toBe("New followers");
    expect(followers?.value).toBe(96);
    expect(followers?.kind).toBe("gain");
    expect(followers?.metric?.changePct).toBe(35.2);
    expect(followers?.note).toBe("4,821 followers now");
    expect(followers?.noteTitle).toBe("4,821 followers now.");
    expect(formatGain(114)).toBe("+114");
    expect(formatGain(-3)).toBe("−3");
  });

  test("New followers shows only the total when the gain is unavailable", () => {
    const data = overview("PERSON", { followers: { total: 4821, gained: null } });
    const followers = buildKpiTiles(data).lead.find((tile) => tile.key === "followers");
    expect(followers?.value).toBeNull();
    expect(followers?.unavailable).toBe(true);
    expect(followers?.note).toBe("4,821 followers now");
  });

  test("every lead tile gets one short note", () => {
    const person = buildKpiTiles(overview("PERSON")).lead;
    expect(person.find((t) => t.key === "impressions")?.note).toBe("655 a day on average");
    expect(person.find((t) => t.key === "membersReached")?.note).toBe("Unique people");
    const org = buildKpiTiles(overview("ORGANIZATION")).lead;
    expect(org.find((t) => t.key === "clicks")?.note).toBe("0.5% of impressions");
    expect(org.find((t) => t.key === "engagementRate")?.note).toBe("Includes clicks");
    const tiny = overview("PERSON");
    tiny.metrics.impressions = metric(2);
    const tinyLead = buildKpiTiles(tiny).lead;
    expect(tinyLead.find((t) => t.key === "impressions")?.note).toBe("Under 1 a day");
    const tinyRate = tinyLead.find((t) => t.key === "engagementRate");
    expect(tinyRate?.note).toBe("Reactions, comments, reposts");
    expect(tinyRate?.chip?.label).toBe("Small sample");
    expect(tinyRate?.chip?.title).toBe("Fewer than 100 impressions in this period, so the rate can swing widely.");
    expect(org.find((t) => t.key === "engagementRate")?.chip).toBeUndefined();
    const mid = overview("PERSON");
    mid.metrics.impressions = metric(72);
    const midDays = mid.range?.days || 28;
    const midNote = buildKpiTiles(mid).lead.find((t) => t.key === "impressions")?.note;
    expect(midNote).toBe(`${Math.round((72 / midDays) * 10) / 10} a day on average`);
    const even = overview("PERSON");
    even.metrics.impressions = metric(56);
    expect(buildKpiTiles(even).lead.find((t) => t.key === "impressions")?.note).toBe(
      `${Math.round((56 / (even.range?.days || 28)) * 10) / 10} a day on average`,
    );
    const tinyOrg = overview("ORGANIZATION");
    tinyOrg.metrics.impressions = metric(2);
    const tinyOrgRate = buildKpiTiles(tinyOrg).lead.find((t) => t.key === "engagementRate");
    expect(tinyOrgRate?.note).toBe("Includes clicks");
    expect(tinyOrgRate?.chip?.label).toBe("Small sample");
    expect(tinyOrgRate?.noteTitle).toBe("Reactions, comments, reposts and clicks ÷ impressions");
    const none = overview("ORGANIZATION");
    none.metrics.impressions = metric(0);
    expect(buildKpiTiles(none).lead.find((t) => t.key === "clicks")?.note).toBe("No impressions yet");
  });

  test("pending follower days replace the chip and show in the note", () => {
    const day = (followersGained: number | null): AnalyticsSeriesPoint => ({
      date: "2026-10-14", impressions: 1, reactions: 0, comments: 0, reposts: 0, followersGained, clicks: 0, pageViews: 0,
    });
    const series = [day(1), day(2), day(null), day(null)];
    expect(trailingFollowerLagDays(series)).toBe(2);
    const org = buildKpiTiles(overview("ORGANIZATION", { followers: { total: 9, gained: metric(3, 10) }, series }));
    const tile = org.lead.find((t) => t.key === "followers");
    expect(tile?.note).toBe("9 followers now · last 2 days not reported yet");
    expect(tile?.noteTitle).toBe("9 followers now. LinkedIn has not published the last 2 days yet.");
    const oneDay = buildKpiTiles(overview("ORGANIZATION", { followers: { total: 9, gained: metric(3, 10) }, series: [day(1), day(null)] }));
    expect(oneDay.lead.find((t) => t.key === "followers")?.note).toBe("9 followers now · last day not reported yet");
    expect(oneDay.lead.find((t) => t.key === "followers")?.noteTitle).toBe("9 followers now. LinkedIn has not published the last day yet.");
    expect(followerLagFootnote(2)).toBe("LinkedIn has not published follower figures for the last 2 days yet.");
    expect(followerLagFootnote(1)).toContain("last 1 day yet");
    expect(tile?.change).toBe("none");
    const person = buildKpiTiles(overview("PERSON", { followers: { total: 9, gained: metric(3, 10) }, series }));
    expect(person.lead.find((t) => t.key === "followers")?.note).toBe("9 followers now");
  });

  test("points change and comparison availability", () => {
    expect(formatPointsChange(2.6, 2.9)).toEqual({ direction: "down", label: "▼ 0.3 pts" });
    expect(formatPointsChange(3.5, 2.9).label).toBe("▲ 0.6 pts");
    expect(formatPointsChange(2.6, null).direction).toBe("none");
    expect(hasComparison(overview("PERSON"))).toBe(true);
    const bare = overview("PERSON", { followers: { total: 1, gained: metric(1) } });
    for (const key of Object.keys(bare.metrics) as Array<keyof typeof bare.metrics>) {
      if (bare.metrics[key]) bare.metrics[key] = metric(bare.metrics[key]!.value);
    }
    expect(hasComparison(bare)).toBe(false);
    expect(NO_COMPARISON).toBe("No earlier period to compare");
  });

  test("organization leads with clicks and keeps page metrics in the strip", () => {
    const { lead, more } = buildKpiTiles(overview("ORGANIZATION"));
    expect(lead.map((tile) => tile.key)).toEqual(["impressions", "engagementRate", "followers", "clicks"]);
    expect(more.map((tile) => tile.key)).toEqual(["reactions", "comments", "reposts", "uniqueImpressions", "pageViews"]);
    expect(engagementRateNote("ORGANIZATION")).toContain("clicks");
  });

  test("null metrics are hidden unless LinkedIn failed to return them", () => {
    const data = overview("PERSON");
    data.metrics.comments = null;
    data.metrics.reposts = null;
    data.unavailable = ["reposts"];
    const { more } = buildKpiTiles(data);
    expect(more.find((tile) => tile.key === "comments")).toBeUndefined();
    expect(more.find((tile) => tile.key === "reposts")?.unavailable).toBe(true);
  });

  test("comparison text names the previous period", () => {
    expect(formatComparison(28)).toBe("Compared with the previous 28 days");
  });
});

describe("chart maths", () => {
  const layout = { width: 300, height: 120, left: 20, right: 0, top: 10, bottom: 20 };

  test("scale contains the max with 3-4 gridlines", () => {
    const scale = chartScale([0, 640, 1180, null]);
    expect(scale.max).toBeGreaterThanOrEqual(1180);
    expect(scale.ticks[0]).toBe(0);
    expect(scale.ticks.length).toBeGreaterThanOrEqual(3);
    expect(scale.ticks.length).toBeLessThanOrEqual(5);
    expect(chartScale([0, 0]).max).toBeGreaterThan(0);
  });

  test("null days are gaps, not zeros", () => {
    const points = layoutPoints([10, null, 20], layout, 20);
    expect(points[1].y).toBeNull();
    expect(points[0].y).toBeGreaterThan(points[2].y as number);
    expect(pointSegments(points)).toHaveLength(2);
    const path = linePath(layoutPoints([1, 2, null, 3, 4], layout, 4));
    expect(path.match(/M/g)).toHaveLength(2);
    expect(areaPath(layoutPoints([1, 2, null, 3, 4], layout, 4), 100).match(/Z/g)).toHaveLength(2);
  });

  test("zero sits on the baseline", () => {
    const [zero] = layoutPoints([0, 5], layout, 5);
    expect(zero.y).toBe(layout.height - layout.bottom);
  });

  test("labels and hit testing", () => {
    expect(labelIndices(28, 5)).toEqual([0, 7, 14, 20, 27]);
    expect(labelIndices(3, 5)).toEqual([0, 1, 2]);
    expect(indexAtX(-50, layout, 10)).toBe(0);
    expect(indexAtX(1000, layout, 10)).toBe(9);
  });

  test("series values", () => {
    const point = (extra: Partial<AnalyticsSeriesPoint>): AnalyticsSeriesPoint => ({
      date: "2026-10-14", impressions: 1, reactions: 2, comments: 3, reposts: null, followersGained: null, clicks: null, pageViews: null, ...extra,
    });
    expect(engagementsOf(point({}))).toBe(5);
    expect(engagementsOf(point({ reactions: null, comments: null }))).toBeNull();
    expect(engagementsOf(point({ clicks: 4 }))).toBe(5);
    expect(engagementsOf(point({ clicks: 4 }), true)).toBe(9);
    expect(engagementsOf(point({ reactions: null, comments: null, clicks: 4 }), true)).toBe(4);
    expect(seriesValues([point({ clicks: 4 })], "engagements", "ORGANIZATION")).toEqual([9]);
    expect(seriesValues([point({ clicks: 4 })], "engagements", "PERSON")).toEqual([5]);
    expect(seriesValues([point({}), point({ impressions: null })], "impressions")).toEqual([1, null]);
    expect(hasTrailingFollowerLag([point({ followersGained: 1 }), point({})])).toBe(true);
    expect(sumValues([1, null, 2])).toBe(3);
    expect(sumValues([null])).toBeNull();
    expect(chartMetricsFor("PERSON").map((item) => item.key)).not.toContain("pageViews");
    expect(chartMetricsFor("ORGANIZATION").map((item) => item.key)).toContain("pageViews");
  });
});

describe("posts", () => {
  const post = (urn: string, extra: Partial<AnalyticsPost>): AnalyticsPost => ({
    urn, postId: null, text: urn, publishedAt: "2026-10-20T08:00:00.000Z", url: "https://x",
    impressions: null, reactions: null, comments: null, reposts: null, clicks: null, engagementRate: null, ...extra,
  });
  const posts = [post("a", { impressions: 10, reactions: 1 }), post("b", { impressions: 50 }), post("c", {})];

  test("sorts with nulls last in both directions", () => {
    expect(sortPosts(posts, "impressions", "desc").map((item) => item.urn)).toEqual(["b", "a", "c"]);
    expect(sortPosts(posts, "impressions", "asc").map((item) => item.urn)).toEqual(["a", "b", "c"]);
  });

  test("coverage note: two facts only, the 100% explanation lives in the footnote", () => {
    expect(postsCoverageNote("all_posts", true).endsWith("Engagement rate counts clicks.")).toBe(true);
    expect(postsCoverageNote("all_posts", true)).not.toContain("100%");
    expect(postsCoverageNote("all_posts", false)).not.toContain("clicks");
    expect(postsCoverageNote("marquill_posts")).toBe(
      "Only posts published with Marquill. LinkedIn doesn't share a personal account's other posts. Figures are lifetime.",
    );
    expect(RATE_OVER_100_NOTE).toBe("A rate above 100% means more engagements than impressions, which happens on a small post.");
  });

  test("range label, metric noun and audience value formats", () => {
    expect(formatRangeVs(28)).toBe("Last 28 days vs the 28 before");
    expect(formatRangeVs(7)).toBe("Last 7 days vs the 7 before");
    expect(metricNoun("Impressions", 12)).toBe("impressions");
    expect(metricNoun("New followers", 1)).toBe("new follower");
    expect(metricNoun("Page views", 0)).toBe("page views");
    expect(formatAudienceValue(3, 42.857, true)).toBe("3 · 43%");
    expect(formatAudienceValue(4310, 33.6, false)).toBe("4,310 · 33.6%");
  });

  test("mobile value labels are singular only at exactly 1", () => {
    const column = (key: string) => POST_COLUMNS.find((item) => item.key === key)!;
    expect(postValueLabel(column("reposts"), 1)).toBe("repost");
    expect(postValueLabel(column("clicks"), 1)).toBe("click");
    expect(postValueLabel(column("reactions"), 1)).toBe("reaction");
    expect(postValueLabel(column("comments"), 1)).toBe("comment");
    expect(postValueLabel(column("impressions"), 1)).toBe("impression");
    expect(postValueLabel(column("impressions"), 2)).toBe("impressions");
    expect(postValueLabel(column("reposts"), 0)).toBe("reposts");
  });

  test("hides columns that are null everywhere", () => {
    expect(visiblePostColumns(posts).map((column) => column.key)).toEqual(["impressions", "reactions"]);
  });
});

describe("cache", () => {
  test("keeps only ok responses and expires", () => {
    const cache = new AnalyticsCache<{ access: string }>();
    cache.set("k", { access: "unavailable" });
    expect(cache.get("k")).toBeUndefined();
    cache.set("k", { access: "ok" }, 0);
    expect(cache.get("k", 1000)).toBeDefined();
    expect(cache.get("k", 10 * 60_000)).toBeUndefined();
  });
});

describe("isAnalyticsOff", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  const future = "2026-12-01T00:00:00Z";
  const past = "2026-11-01T00:00:00Z";
  test("a personal account with no grant is off", () => {
    expect(isAnalyticsOff({ accountType: "PERSONAL" }, now)).toBe(true);
  });
  test("an account type the api stores as PERSON, or none at all, counts as personal", () => {
    expect(isAnalyticsOff({ accountType: "PERSON" as never }, now)).toBe(true);
    expect(isAnalyticsOff({}, now)).toBe(true);
    expect(isAnalyticsOff({ analyticsExpiresAt: future }, now)).toBe(false);
  });
  test("a lapsed or unreadable grant is off, a current one is on", () => {
    expect(isAnalyticsOff({ accountType: "PERSONAL", analyticsExpiresAt: past }, now)).toBe(true);
    expect(isAnalyticsOff({ accountType: "PERSONAL", analyticsExpiresAt: "garbage" }, now)).toBe(true);
    expect(isAnalyticsOff({ accountType: "PERSONAL", analyticsExpiresAt: future }, now)).toBe(false);
  });
  test("an organization page is never off", () => {
    expect(isAnalyticsOff({ accountType: "ORGANIZATION" }, now)).toBe(false);
    expect(isAnalyticsOff({ accountType: "ORGANIZATION", analyticsExpiresAt: past }, now)).toBe(false);
  });
});
