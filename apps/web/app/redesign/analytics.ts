import type {
  AnalyticsAccountType,
  AnalyticsAudience,
  AnalyticsMetric,
  AnalyticsMetricKey,
  AnalyticsOverview,
  AnalyticsPost,
  AnalyticsPostsResponse,
  AnalyticsRangeKey,
  AnalyticsSeriesPoint,
  ConnectedAccount,
} from "../lib/types";
import { API_BASE, readApi } from "./api";

export const ANALYTICS_RANGES: Array<{ key: AnalyticsRangeKey; label: string; days: number }> = [
  { key: "7d", label: "7 days", days: 7 },
  { key: "28d", label: "28 days", days: 28 },
  { key: "90d", label: "90 days", days: 90 },
];
export const DEFAULT_ANALYTICS_RANGE: AnalyticsRangeKey = "28d";

export function parseAnalyticsRange(value: unknown): AnalyticsRangeKey {
  const raw = Array.isArray(value) ? value[0] : value;
  return ANALYTICS_RANGES.some((range) => range.key === raw)
    ? (raw as AnalyticsRangeKey)
    : DEFAULT_ANALYTICS_RANGE;
}

export function rangeDays(range: AnalyticsRangeKey) {
  return ANALYTICS_RANGES.find((item) => item.key === range)?.days ?? 28;
}

/**
 * True when the account is a personal profile whose analytics grant is missing
 * or lapsed, so the analytics API would answer `missing_scope`. Pages are read
 * with the main token and are never "off". Mirrors `loadAccount` in the api.
 */
export function isAnalyticsOff(
  account: Pick<ConnectedAccount, "accountType" | "analyticsExpiresAt">,
  now = Date.now(),
) {
  if (account.accountType === "ORGANIZATION") return false;
  if (!account.analyticsExpiresAt) return true;
  const expires = new Date(account.analyticsExpiresAt).getTime();
  return Number.isNaN(expires) || expires <= now;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const exactFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Exact value with thousands separators: 18340 -> "18,340". */
export function formatExact(value: number) {
  return exactFormatter.format(value);
}

/** Compact only above 10K: 18340 -> "18.3K", 9120 -> "9,120". */
export function formatCompact(value: number) {
  return Math.abs(value) >= 10_000 ? compactFormatter.format(value) : formatExact(value);
}

/** Always-compact form for chart axes: 1500 -> "1.5K", 800 -> "800". */
export function formatAxis(value: number) {
  return Math.abs(value) >= 1_000 ? compactFormatter.format(value) : formatExact(value);
}

export function formatPercent(value: number) {
  return `${exactFormatter.format(value)}%`;
}

export type ChangeView = {
  direction: "up" | "down" | "flat" | "none";
  label: string;
};

export function formatChange(changePct: number | null | undefined): ChangeView {
  if (changePct === null || changePct === undefined || Number.isNaN(changePct)) {
    return { direction: "none", label: "" };
  }
  if (changePct === 0) return { direction: "flat", label: "0%" };
  const magnitude = exactFormatter.format(Math.abs(changePct));
  return changePct > 0
    ? { direction: "up", label: `▲ ${magnitude}%` }
    : { direction: "down", label: `▼ ${magnitude}%` };
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses a contract `YYYY-MM-DD` as a UTC instant so it never shifts a day. */
export function parseUtcDate(value: string) {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatUtcDate(
  value: string,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
) {
  const date = value.length > 10 ? new Date(value) : parseUtcDate(value);
  if (!date || Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(date);
}

/** Difference in percentage points, for metrics that are already percentages. */
export function formatPointsChange(value: number, previous: number | null | undefined): ChangeView {
  if (previous === null || previous === undefined || Number.isNaN(previous) || Number.isNaN(value)) {
    return { direction: "none", label: "" };
  }
  const diff = Math.round((value - previous) * 10) / 10;
  if (diff === 0) return { direction: "flat", label: "0 pts" };
  const magnitude = exactFormatter.format(Math.abs(diff));
  return diff > 0
    ? { direction: "up", label: `▲ ${magnitude} pts` }
    : { direction: "down", label: `▼ ${magnitude} pts` };
}

/** The one visible statement of what every change chip is measured against. */
export function formatComparison(days: number) {
  return `Compared with the previous ${days} days`;
}

/** Short form for tight spaces: "vs previous 28 days". */
export function formatComparisonShort(days: number) {
  return `vs previous ${days} days`;
}

/** Heading meta for the impression figures and chips: "Last 28 days vs the 28 before". */
export function formatRangeVs(days: number) {
  return `Last ${days} days vs the ${days} before`;
}

/** "12 impressions" / "1 new follower": the metric noun, singular only at exactly 1. */
export function metricNoun(label: string, value: number) {
  const lower = label.toLowerCase();
  return value === 1 ? lower.replace(/s$/, "") : lower;
}

/** Audience value, count first: "3 · 43%", or "4,310 · 33.6%" once the facet reaches 100 followers. */
export function formatAudienceValue(count: number, share: number, wholeShare: boolean) {
  return `${formatExact(count)} · ${wholeShare ? `${Math.round(share)}%` : formatPercent(share)}`;
}

export const NO_COMPARISON = "No earlier period to compare";

/** True when at least one metric has a previous period to compare with. */
export function hasComparison(overview: AnalyticsOverview) {
  const metrics = [...Object.values(overview.metrics), overview.followers?.gained];
  return metrics.some((metric) => metric && metric.changePct !== null && metric.changePct !== undefined);
}

export function formatUpdated(fetchedAt: string | undefined, now = Date.now()) {
  if (!fetchedAt) return "";
  const time = new Date(fetchedAt).getTime();
  if (Number.isNaN(time)) return "";
  const minutes = Math.max(0, Math.floor((now - time) / 60_000));
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours} h ago`;
  return `Updated ${formatUtcDate(fetchedAt)}`;
}

// ---------------------------------------------------------------------------
// KPI tiles
// ---------------------------------------------------------------------------

export type KpiTile = {
  key: string;
  label: string;
  /** Drives the change chip; null renders no chip. */
  metric: AnalyticsMetric | null;
  /** null renders as an unavailable "—". */
  value: number | null;
  /** "gain" shows a signed period gain such as "+114". */
  kind: "count" | "percent" | "gain";
  /** Quiet one-line helper text under the value. */
  note?: string;
  /** Full text for the note's tooltip. */
  noteTitle?: string;
  /** A neutral chip shown in place of the comparison chip (e.g. "Small sample"). */
  chip?: { label: string; title: string };
  /** How the change chip is computed; "none" hides it. */
  change: "percent" | "points" | "none";
  unavailable: boolean;
};

export type KpiLayout = {
  /** The lead row of four tiles. */
  lead: KpiTile[];
  /** The compact secondary strip. */
  more: KpiTile[];
};

const TILE_LABELS: Record<AnalyticsMetricKey, string> = {
  impressions: "Impressions",
  engagementRate: "Engagement rate",
  reactions: "Reactions",
  comments: "Comments",
  reposts: "Reposts",
  membersReached: "Members reached",
  uniqueImpressions: "Unique impressions",
  clicks: "Clicks",
  pageViews: "Page views",
};

const LEAD_KEYS: Record<AnalyticsAccountType, AnalyticsMetricKey[]> = {
  PERSON: ["impressions", "engagementRate", "membersReached"],
  ORGANIZATION: ["impressions", "engagementRate", "clicks"],
};

const MORE_KEYS: Record<AnalyticsAccountType, AnalyticsMetricKey[]> = {
  PERSON: ["reactions", "comments", "reposts"],
  ORGANIZATION: ["reactions", "comments", "reposts", "uniqueImpressions", "pageViews"],
};

export function engagementRateNote(accountType: AnalyticsAccountType) {
  return accountType === "ORGANIZATION"
    ? "Reactions, comments, reposts and clicks ÷ impressions"
    : "Reactions, comments and reposts ÷ impressions";
}

const SMALL_SAMPLE_IMPRESSIONS = 100;

function tileNote(
  key: AnalyticsMetricKey,
  overview: AnalyticsOverview,
  type: AnalyticsAccountType,
): { note?: string; noteTitle?: string; chip?: { label: string; title: string } } {
  const metric = overview.metrics[key];
  if (!metric) return {};
  const impressions = overview.metrics.impressions?.value ?? null;
  if (key === "impressions") {
    const days = overview.range?.days || 28;
    const average = metric.value / days;
    if (average < 1) return { note: "Under 1 a day" };
    const tenths = Math.round(average * 10) / 10;
    const shown = tenths < 10 ? String(tenths) : formatCompact(Math.round(average));
    return { note: `${shown} a day on average` };
  }
  if (key === "engagementRate") {
    const small = impressions !== null && impressions < SMALL_SAMPLE_IMPRESSIONS;
    return {
      note: type === "ORGANIZATION" ? "Includes clicks" : "Reactions, comments, reposts",
      noteTitle: engagementRateNote(type),
      chip: small
        ? {
            label: "Small sample",
            title: `Fewer than ${SMALL_SAMPLE_IMPRESSIONS} impressions in this period, so the rate can swing widely.`,
          }
        : undefined,
    };
  }
  if (key === "clicks") {
    if (impressions === null) return {};
    if (impressions <= 0) return { note: "No impressions yet" };
    return { note: `${formatPercent(Math.round((metric.value / impressions) * 1000) / 10)} of impressions` };
  }
  if (key === "membersReached") return { note: "Unique people" };
  return {};
}

/** "1 day" / "2 days". */
export function pendingDaysLabel(days: number) {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/** Chart footnote for late follower figures, built from the real pending day count. */
export function followerLagFootnote(pendingDays: number) {
  return `LinkedIn has not published follower figures for the last ${pendingDaysLabel(pendingDays)} yet.`;
}

export function formatGain(value: number) {
  return `${value < 0 ? "−" : "+"}${formatCompact(Math.abs(value))}`;
}

/**
 * Which tiles to show. A tile renders only when its metric is present; a null
 * metric that LinkedIn failed to return (listed in `unavailable`) shows as "—".
 * The lead row is Impressions, Engagement rate, New followers and one reach
 * metric; everything else goes in the compact strip.
 */
export function buildKpiTiles(overview: AnalyticsOverview): KpiLayout {
  const unavailable = new Set(overview.unavailable ?? []);
  const type: AnalyticsAccountType = LEAD_KEYS[overview.account.accountType] ? overview.account.accountType : "PERSON";

  const build = (key: AnalyticsMetricKey): KpiTile | null => {
    const metric = overview.metrics[key] ?? null;
    if (!metric && !unavailable.has(key)) return null;
    return {
      key,
      label: TILE_LABELS[key],
      metric,
      value: metric ? metric.value : null,
      kind: key === "engagementRate" ? "percent" : "count",
      ...tileNote(key, overview, type),
      change: key === "engagementRate" ? "points" : "percent",
      unavailable: !metric,
    };
  };

  const lead: KpiTile[] = [];
  for (const key of LEAD_KEYS[type]) {
    const tile = build(key);
    if (tile) lead.push(tile);
    if (key === "engagementRate") {
      const followers = buildFollowersTile(overview, unavailable);
      if (followers) lead.push(followers);
    }
  }
  const more = MORE_KEYS[type].map(build).filter((tile): tile is KpiTile => tile !== null);
  return { lead, more };
}

function buildFollowersTile(overview: AnalyticsOverview, unavailable: Set<string>): KpiTile | null {
  const { total, gained } = overview.followers ?? { total: null, gained: null };
  if (!gained && total === null && !unavailable.has("followers.total") && !unavailable.has("followers.gained")) {
    return null;
  }
  const pending = overview.account.accountType === "ORGANIZATION" ? trailingFollowerLagDays(overview.series ?? []) : 0;
  const now = total === null ? null : `${formatCompact(total)} ${total === 1 ? "follower" : "followers"} now`;
  const lag = pending > 0 ? `last ${pending === 1 ? "day" : `${pending} days`} not reported yet` : null;
  const nowFull = total === null ? null : `${formatCompact(total)} ${total === 1 ? "follower" : "followers"} now.`;
  const lagFull = pending > 0 ? `LinkedIn has not published the last ${pending === 1 ? "day" : `${pending} days`} yet.` : null;
  return {
    key: "followers",
    label: "New followers",
    metric: gained,
    value: gained ? gained.value : null,
    kind: "gain",
    note: [now, lag].filter(Boolean).join(" · ") || undefined,
    noteTitle: [nowFull, lagFull].filter(Boolean).join(" ") || undefined,
    change: pending > 0 ? "none" : "percent",
    unavailable: !gained,
  };
}

// ---------------------------------------------------------------------------
// Trend chart
// ---------------------------------------------------------------------------

export type ChartMetricKey = "impressions" | "engagements" | "followersGained" | "pageViews";

export const CHART_METRICS: Array<{ key: ChartMetricKey; label: string; organizationOnly?: boolean }> = [
  { key: "impressions", label: "Impressions" },
  { key: "engagements", label: "Engagements" },
  { key: "followersGained", label: "New followers" },
  { key: "pageViews", label: "Page views", organizationOnly: true },
];

export function chartMetricsFor(accountType: AnalyticsAccountType) {
  return CHART_METRICS.filter((metric) => !metric.organizationOnly || accountType === "ORGANIZATION");
}

/** Reactions + comments + reposts (+ clicks for pages); null only when every part is null. */
export function engagementsOf(point: AnalyticsSeriesPoint, includeClicks = false) {
  const parts = includeClicks
    ? [point.reactions, point.comments, point.reposts, point.clicks]
    : [point.reactions, point.comments, point.reposts];
  if (parts.every((part) => part === null || part === undefined)) return null;
  return parts.reduce<number>((sum, part) => sum + (part ?? 0), 0);
}

/** Sum of the present days; null when every day is missing. */
export function sumValues(values: Array<number | null>) {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? present.reduce((sum, value) => sum + value, 0) : null;
}

export function seriesValues(
  series: AnalyticsSeriesPoint[],
  key: ChartMetricKey,
  accountType: AnalyticsAccountType = "PERSON",
): Array<number | null> {
  return series.map((point) => {
    if (key === "engagements") return engagementsOf(point, accountType === "ORGANIZATION");
    return point[key] ?? null;
  });
}

function niceStep(raw: number) {
  if (raw <= 1) return 1;
  const exponent = Math.floor(Math.log10(raw));
  const base = 10 ** exponent;
  const fraction = raw / base;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * base;
}

/** A y-axis with 3-4 gridlines (plus zero) that always contains `max`. */
export function chartScale(values: Array<number | null>, intervals = 3) {
  const max = values.reduce<number>((top, value) => (value !== null && value > top ? value : top), 0);
  const step = niceStep(max / intervals);
  const count = Math.max(2, Math.ceil(max / step));
  const ticks = Array.from({ length: count + 1 }, (_, index) => index * step);
  return { max: step * count, ticks };
}

export type ChartLayout = {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type ChartPoint = {
  index: number;
  /** Centre of the point's band. */
  x: number;
  /** null for a gap day. */
  y: number | null;
  value: number | null;
};

export function layoutPoints(values: Array<number | null>, layout: ChartLayout, max: number): ChartPoint[] {
  const plotWidth = Math.max(1, layout.width - layout.left - layout.right);
  const plotHeight = Math.max(1, layout.height - layout.top - layout.bottom);
  const band = plotWidth / Math.max(1, values.length);
  return values.map((value, index) => ({
    index,
    x: layout.left + band * (index + 0.5),
    y: value === null ? null : layout.top + plotHeight * (1 - (max > 0 ? value / max : 0)),
    value,
  }));
}

/** Runs of consecutive non-null points; a null day always breaks the line. */
export function pointSegments(points: ChartPoint[]) {
  const segments: ChartPoint[][] = [];
  let current: ChartPoint[] = [];
  for (const point of points) {
    if (point.y === null) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push(point);
    }
  }
  if (current.length) segments.push(current);
  return segments;
}

const round = (value: number) => Math.round(value * 100) / 100;

/** SVG path for the line; one `M` per segment so gaps stay gaps. */
export function linePath(points: ChartPoint[]) {
  return pointSegments(points)
    .filter((segment) => segment.length > 1)
    .map((segment) =>
      segment
        .map((point, index) => `${index === 0 ? "M" : "L"}${round(point.x)} ${round(point.y as number)}`)
        .join(" "),
    )
    .join(" ");
}

/** SVG path for the area under each segment, closed to `baseline`. */
export function areaPath(points: ChartPoint[], baseline: number) {
  return pointSegments(points)
    .filter((segment) => segment.length > 1)
    .map((segment) => {
      const first = segment[0];
      const last = segment[segment.length - 1];
      const line = segment.map((point) => `L${round(point.x)} ${round(point.y as number)}`).join(" ");
      return `M${round(first.x)} ${round(baseline)} ${line} L${round(last.x)} ${round(baseline)} Z`;
    })
    .join(" ");
}

/** Indices for sparse x-axis labels, always including first and last. */
export function labelIndices(count: number, wanted: number) {
  if (count <= 0) return [];
  if (count <= wanted) return Array.from({ length: count }, (_, index) => index);
  const indices = new Set<number>();
  for (let step = 0; step < wanted; step += 1) {
    indices.add(Math.round((step * (count - 1)) / (wanted - 1)));
  }
  return [...indices].sort((left, right) => left - right);
}

/** Index of the band under an x coordinate, clamped to the series. */
export function indexAtX(x: number, layout: ChartLayout, count: number) {
  if (count <= 0) return -1;
  const plotWidth = Math.max(1, layout.width - layout.left - layout.right);
  const index = Math.floor(((x - layout.left) / plotWidth) * count);
  return Math.min(count - 1, Math.max(0, index));
}

export function describeSeries(label: string, series: AnalyticsSeriesPoint[], values: Array<number | null>) {
  const present = values.filter((value): value is number => value !== null);
  if (!present.length || !series.length) return `${label}: no data in this period.`;
  const total = present.reduce((sum, value) => sum + value, 0);
  const peakIndex = values.findIndex((value) => value === Math.max(...present));
  return `${label} per day from ${formatUtcDate(series[0].date)} to ${formatUtcDate(
    series[series.length - 1].date,
  )}. Total ${formatExact(total)}, highest on ${formatUtcDate(series[peakIndex].date)} with ${formatExact(
    present[present.indexOf(Math.max(...present))],
  )}.`;
}

/** How many of the most recent days have no follower figure yet. */
export function trailingFollowerLagDays(series: AnalyticsSeriesPoint[]) {
  let count = 0;
  for (let index = series.length - 1; index >= 0 && series[index].followersGained === null; index -= 1) count += 1;
  return count;
}

/** True when an organization's trailing follower days are not published yet. */
export function hasTrailingFollowerLag(series: AnalyticsSeriesPoint[]) {
  const last = series[series.length - 1];
  return Boolean(last) && last.followersGained === null;
}

// ---------------------------------------------------------------------------
// Top posts
// ---------------------------------------------------------------------------

export type PostSortKey =
  | "impressions"
  | "reactions"
  | "comments"
  | "reposts"
  | "clicks"
  | "engagementRate";
export type SortDirection = "asc" | "desc";

export const POST_COLUMNS: Array<{ key: PostSortKey; label: string; singular: string }> = [
  { key: "impressions", label: "Impressions", singular: "Impression" },
  { key: "reactions", label: "Reactions", singular: "Reaction" },
  { key: "comments", label: "Comments", singular: "Comment" },
  { key: "reposts", label: "Reposts", singular: "Repost" },
  { key: "clicks", label: "Clicks", singular: "Click" },
  { key: "engagementRate", label: "Engagement rate", singular: "Engagement rate" },
];

/** Lowercase label for a value on the mobile list: singular only when the value is exactly 1. */
export function postValueLabel(column: { label: string; singular: string }, value: number | null) {
  return (value === 1 ? column.singular : column.label).toLowerCase();
}

/** Stable sort; null values always sink to the bottom whatever the direction. */
export function sortPosts(posts: AnalyticsPost[], key: PostSortKey, direction: SortDirection) {
  const sign = direction === "asc" ? 1 : -1;
  return posts
    .map((post, index) => ({ post, index }))
    .sort((left, right) => {
      const a = left.post[key];
      const b = right.post[key];
      if (a === null && b === null) return left.index - right.index;
      if (a === null) return 1;
      if (b === null) return -1;
      return a === b ? left.index - right.index : (a - b) * sign;
    })
    .map((entry) => entry.post);
}

/** Columns where at least one row has a value. */
export function visiblePostColumns(posts: AnalyticsPost[]) {
  return POST_COLUMNS.filter((column) => posts.some((post) => post[column.key] !== null));
}

export function postsCoverageNote(coverage: AnalyticsPostsResponse["coverage"], countsClicks = false) {
  if (coverage === "marquill_posts" && !countsClicks) {
    return "Only posts published with Marquill. LinkedIn doesn't share a personal account's other posts. Figures are lifetime.";
  }
  const base =
    coverage === "all_posts"
      ? "Posts published in this period. LinkedIn reports lifetime figures for each post."
      : "Posts published with Marquill in this period. LinkedIn reports lifetime figures for each post.";
  return countsClicks ? `${base} Engagement rate counts clicks.` : base;
}

/** Shown under the posts list when a listed post's rate is above 100%. */
export const RATE_OVER_100_NOTE =
  "A rate above 100% means more engagements than impressions, which happens on a small post.";

// ---------------------------------------------------------------------------
// Fetching and the in-memory session cache
// ---------------------------------------------------------------------------

type Envelope<T> = { data?: T };

const CACHE_TTL_MS = 5 * 60_000;

export class AnalyticsCache<T extends { access: string }> {
  private entries = new Map<string, { at: number; value: T }>();

  get(key: string, now = Date.now()) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (now - entry.at > CACHE_TTL_MS) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /** Only healthy responses are kept, so a reconnect or retry always refetches. */
  set(key: string, value: T, now = Date.now()) {
    if (value.access !== "ok") return;
    this.entries.set(key, { at: now, value });
  }

  clear() {
    this.entries.clear();
  }
}

export const overviewCache = new AnalyticsCache<AnalyticsOverview>();
export const postsCache = new AnalyticsCache<AnalyticsPostsResponse>();
export const audienceCache = new AnalyticsCache<AnalyticsAudience>();

export function clearAnalyticsCaches() {
  overviewCache.clear();
  postsCache.clear();
  audienceCache.clear();
}

function accountPath(accountId: string, resource: string, query: string) {
  return `${API_BASE}/analytics/accounts/${encodeURIComponent(accountId)}/${resource}${query}`;
}

async function unwrap<T>(request: Promise<Envelope<T> | null>) {
  const payload = await request;
  if (!payload?.data) throw new Error("Analytics response was empty.");
  return payload.data;
}

export function fetchOverview(accountId: string, range: AnalyticsRangeKey, refresh: boolean, signal?: AbortSignal) {
  const query = `?range=${range}${refresh ? "&refresh=true" : ""}`;
  return unwrap(readApi<Envelope<AnalyticsOverview>>(accountPath(accountId, "overview", query), { signal }));
}

export function fetchPosts(accountId: string, range: AnalyticsRangeKey, refresh: boolean, signal?: AbortSignal) {
  const query = `?range=${range}${refresh ? "&refresh=true" : ""}`;
  return unwrap(readApi<Envelope<AnalyticsPostsResponse>>(accountPath(accountId, "posts", query), { signal }));
}

export function fetchAudience(accountId: string, refresh: boolean, signal?: AbortSignal) {
  const query = refresh ? "?refresh=true" : "";
  return unwrap(readApi<Envelope<AnalyticsAudience>>(accountPath(accountId, "audience", query), { signal }));
}
