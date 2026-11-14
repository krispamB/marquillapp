"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import LinkedInConnectButton from "./LinkedInConnectButton";
import AnalyticsState, { type AnalyticsStateKind } from "./AnalyticsState";
import AnalyticsChart from "./AnalyticsChart";
import AnalyticsPosts from "./AnalyticsPosts";
import AnalyticsAudienceCard from "./AnalyticsAudience";
import { useAnalyticsResource } from "./useAnalyticsResource";
import {
  ANALYTICS_RANGES,
  audienceCache,
  buildKpiTiles,
  chartMetricsFor,
  fetchAudience,
  fetchOverview,
  fetchPosts,
  isAnalyticsOff,
  formatChange,
  formatComparison,
  formatComparisonShort,
  followerLagFootnote,
  trailingFollowerLagDays,
  formatCompact,
  formatExact,
  formatGain,
  formatPercent,
  formatPointsChange,
  formatUpdated,
  hasComparison,
  NO_COMPARISON,
  overviewCache,
  postsCache,
  rangeDays,
  seriesValues,
  sumValues,
  type ChartMetricKey,
  type ChangeView,
  type KpiTile,
} from "./analytics";
import type {
  AnalyticsRangeKey,
  ConnectedAccount,
} from "../lib/types";

function ChangeChip({ change, days }: { change: ChangeView; days: number }) {
  if (change.direction === "none") return null;
  const amount = change.label.replace(/^[▲▼]\s*/, "");
  const spoken = change.direction === "flat" ? "no change" : `${change.direction} ${amount}`;
  return (
    <span
      className={`mq-analytics-chip is-${change.direction}`}
      role="img"
      aria-label={`${spoken} vs previous ${days} days`}
      title={`vs previous ${days} days`}
    >
      {change.label}
    </span>
  );
}

function tileChange(tile: KpiTile): ChangeView {
  if (tile.unavailable || tile.change === "none" || !tile.metric) return { direction: "none", label: "" };
  if (tile.change === "points") return formatPointsChange(tile.metric.value, tile.metric.previous);
  return formatChange(tile.metric.changePct);
}

function tileValue(tile: KpiTile) {
  if (tile.value === null) return { text: "—", exact: undefined };
  if (tile.kind === "percent") return { text: formatPercent(tile.value), exact: formatPercent(tile.value) };
  if (tile.kind === "gain") return { text: formatGain(tile.value), exact: formatGain(tile.value) };
  return { text: formatCompact(tile.value), exact: formatExact(tile.value) };
}

/** Keeps "last 2 days" on one line when a note wraps. */
function noteWithNoBreaks(note: string): ReactNode {
  const match = /last (?:\d+ days|day)(?= not reported yet)/.exec(note);
  if (!match) return note;
  return (
    <>
      {note.slice(0, match.index)}
      <span className="mq-nowrap">{match[0]}</span>
      {note.slice(match.index + match[0].length)}
    </>
  );
}

function Tile({ tile, days }: { tile: KpiTile; days: number }) {
  const value = tileValue(tile);
  return (
    <div className="mq-card mq-stat-card mq-analytics-tile">
      <span className="mq-label">{tile.label}</span>
      <div className="mq-stat-value-row">
        <strong title={tile.unavailable ? "LinkedIn didn't return this" : value.exact}>{value.text}</strong>
        {tile.chip ? (
          <span className="mq-analytics-chip" title={tile.chip.title}>{tile.chip.label}</span>
        ) : (
          <ChangeChip change={tileChange(tile)} days={days} />
        )}
      </div>
      {tile.note ? (
        <span className="mq-stat-note mq-stat-note-clamp" title={tile.noteTitle ?? tile.note}>{noteWithNoBreaks(tile.note)}</span>
      ) : null}
    </div>
  );
}

function MoreMetrics({ tiles, days }: { tiles: KpiTile[]; days: number }) {
  if (!tiles.length) return null;
  return (
    <section className="mq-card mq-analytics-more" aria-label="More metrics">
      <dl className="mq-analytics-more-list" data-count={tiles.length}>
        {tiles.map((tile) => {
          const value = tileValue(tile);
          return (
            <div key={tile.key} className="mq-analytics-more-item">
              <dt>{tile.label}</dt>
              <dd>
                <strong title={tile.unavailable ? "LinkedIn didn't return this" : value.exact}>{value.text}</strong>
                <ChangeChip change={tileChange(tile)} days={days} />
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

function OverviewSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading analytics">
      <section className="mq-stat-grid">
        {[0, 1, 2, 3].map((tile) => (
          <div key={tile} className="mq-card mq-stat-card">
            <span className="mq-analytics-skel mq-analytics-skel-label" />
            <span className="mq-analytics-skel mq-analytics-skel-value" />
          </div>
        ))}
      </section>
      <section className="mq-card mq-analytics-card">
        <div className="mq-analytics-card-body"><span className="mq-analytics-skel mq-analytics-skel-chart" /></div>
      </section>
    </div>
  );
}

/**
 * LinkedIn analytics for one connected account. The Dashboard renders it when a
 * single account is selected in the shell's account switcher.
 */
export default function AnalyticsPanel({
  connectedAccounts,
  selectedAccountId,
  initialRange = "28d",
  onRangeChange,
  fallback,
}: {
  connectedAccounts: ConnectedAccount[];
  selectedAccountId: string;
  initialRange?: AnalyticsRangeKey;
  /** Called after the user picks a range, so the page can keep it in the URL. */
  onRangeChange?: (range: AnalyticsRangeKey) => void;
  /** Shown below any state where the numbers can't be shown. */
  fallback?: ReactNode;
}) {
  const [range, setRange] = useState<AnalyticsRangeKey>(initialRange);
  const [metric, setMetric] = useState<ChartMetricKey>("impressions");
  const account = connectedAccounts.find((item) => item.id === selectedAccountId);
  const accountId = account?.id ?? null;

  // A personal profile without the analytics grant is known to be off from the account itself,
  // so nothing is requested. Otherwise overview, posts and audience start together; once the
  // overview answers with anything but "ok", posts and audience are released and not asked again.
  const knownOff = account ? isAnalyticsOff(account) : false;
  const overviewKey = accountId && !knownOff ? `${accountId}:${range}` : null;
  const overview = useAnalyticsResource({
    key: overviewKey,
    group: accountId ?? "",
    cache: overviewCache,
    load: (refresh, signal) => fetchOverview(accountId as string, range, refresh, signal),
  });
  const overviewBlocked = Boolean(overview.data && overview.data.access !== "ok");
  const dependentKey = overviewBlocked ? null : overviewKey;
  const posts = useAnalyticsResource({
    key: dependentKey,
    group: accountId ?? "",
    cache: postsCache,
    load: (refresh, signal) => fetchPosts(accountId as string, range, refresh, signal),
  });
  const audience = useAnalyticsResource({
    key: overviewBlocked || !accountId || knownOff ? null : accountId,
    group: accountId ?? "",
    cache: audienceCache,
    load: (refresh, signal) => fetchAudience(accountId as string, refresh, signal),
  });

  const reloadAll = useCallback(() => {
    overview.reload();
    posts.reload();
    audience.reload();
  }, [overview, posts, audience]);

  function changeRange(next: AnalyticsRangeKey) {
    setRange(next);
    onRangeChange?.(next);
  }

  const data = overview.data;
  const days = rangeDays(range);
  const accountName = account?.displayName ?? data?.account.displayName ?? "LinkedIn account";
  const accountType = knownOff
    ? account?.accountType === "ORGANIZATION" ? "ORGANIZATION" : "PERSON"
    : data?.account.accountType ?? (account?.accountType === "ORGANIZATION" ? "ORGANIZATION" : "PERSON");
  const tiles = useMemo(() => (data?.access === "ok" ? buildKpiTiles(data) : { lead: [], more: [] }), [data]);
  const metrics = chartMetricsFor(accountType);
  const activeMetric = metrics.some((item) => item.key === metric) ? metric : "impressions";
  const metricLabel = metrics.find((item) => item.key === activeMetric)?.label ?? "Impressions";
  const values = useMemo(
    () => (data?.access === "ok" ? seriesValues(data.series, activeMetric, accountType) : []),
    [data, activeMetric, accountType],
  );
  const periodTotal = sumValues(values);
  const refreshing = overview.refreshing || posts.refreshing || audience.refreshing;
  const pendingDays = accountType === "ORGANIZATION" && data ? trailingFollowerLagDays(data.series ?? []) : 0;
  const showLagNote = activeMetric === "followersGained" && pendingDays > 0;

  const switchRef = useRef<HTMLDivElement>(null);
  const metricCount = metrics.length;
  const switchMounted = Boolean(account && !knownOff && data?.access === "ok");
  useEffect(() => {
    const node = switchRef.current;
    if (!node) return;
    const update = () => {
      const more = node.scrollLeft + node.clientWidth < node.scrollWidth - 1;
      if (more) node.setAttribute("data-overflow-end", "true");
      else node.removeAttribute("data-overflow-end");
    };
    update();
    node.addEventListener("scroll", update, { passive: true });
    if (typeof ResizeObserver === "undefined") {
      return () => node.removeEventListener("scroll", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => {
      node.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [metricCount, switchMounted]);
  const shownMetric = useRef(activeMetric);
  useEffect(() => {
    if (shownMetric.current === activeMetric) return;
    shownMetric.current = activeMetric;
    const button = switchRef.current?.querySelector<HTMLElement>('button[aria-pressed="true"]');
    button?.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "auto" });
  }, [activeMetric]);

  const isOk = !knownOff && data?.access === "ok";
  const failed = !knownOff && !data && overview.failed;
  const stateKind: AnalyticsStateKind | null = !account
    ? null
    : knownOff
      ? "missing_scope"
      : failed
        ? "failed"
        : data && data.access !== "ok"
          ? data.access
          : null;
  const loading = Boolean(account) && !knownOff && !data && !failed;
  const controlsVisible = loading || isOk;

  let content;
  if (!account) {
    content = (
      <div className="mq-alert">
        Connect a LinkedIn account to see its analytics.{" "}
        <LinkedInConnectButton className="mq-inline-connect">Connect account</LinkedInConnectButton>
      </div>
    );
  } else if (stateKind) {
    content = (
      <>
        <AnalyticsState kind={stateKind} name={accountName} onRetry={overview.reload} onTurnedOn={overview.reload} />
        {fallback}
      </>
    );
  } else if (!data) {
    content = <OverviewSkeleton />;
  } else {
    content = (
      <div aria-busy={overview.isStale || refreshing}>
        <section className="mq-stat-grid mq-analytics-tiles" aria-label="Key metrics">
          {tiles.lead.map((tile) => <Tile key={tile.key} tile={tile} days={days} />)}
        </section>
        <MoreMetrics tiles={tiles.more} days={days} />

        <section className="mq-card mq-analytics-card" aria-label="Trend">
          <div className="mq-card-heading has-sub">
            <div className="mq-analytics-trend-title">
              <span className="mq-title">Trend</span>
              <span className="mq-analytics-trend-total">
                {periodTotal === null
                  ? "No data in this period"
                  : `${formatExact(periodTotal)} ${metricLabel.toLowerCase()} · ${days} days`}
              </span>
            </div>
            <div className="mq-segmented mq-segmented-small mq-analytics-metric-switch" role="group" aria-label="Chart metric" ref={switchRef}>
              {metrics.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={item.key === activeMetric ? "is-active" : ""}
                  aria-pressed={item.key === activeMetric}
                  onClick={() => setMetric(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="mq-analytics-card-body">
            <AnalyticsChart label={metricLabel} series={data.series} values={values} />
            {showLagNote ? <p className="mq-analytics-footnote">{followerLagFootnote(pendingDays)}</p> : null}
          </div>
        </section>
      </div>
    );
  }

  return (
    <>
      {account ? (
        <div className="mq-page-heading mq-analytics-heading">
          <div>
            <h1>{accountName}</h1>
            <p className="mq-analytics-meta">
              {accountType === "ORGANIZATION" ? "Company page" : "Personal profile"}
              {isOk && data ? (
                <>
                  {" · "}
                  {hasComparison(data) ? (
                    <>
                      <span className="mq-analytics-label-full">{formatComparison(days)}</span>
                      <span className="mq-analytics-label-short">{formatComparisonShort(days)}</span>
                    </>
                  ) : (
                    NO_COMPARISON
                  )}
                  {formatUpdated(data.fetchedAt) ? (
                    <>
                      {" · "}
                      <span className="mq-nowrap">{formatUpdated(data.fetchedAt)}</span>
                    </>
                  ) : null}
                </>
              ) : null}
            </p>
          </div>
          {controlsVisible ? (
            <div className="mq-analytics-heading-controls">
              <div className="mq-segmented" role="group" aria-label="Date range">
                {ANALYTICS_RANGES.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={item.key === range ? "is-active" : ""}
                    aria-pressed={item.key === range}
                    onClick={() => changeRange(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="mq-icon-button"
                aria-label="Refresh analytics"
                title="Refresh analytics"
                disabled={refreshing || !accountId}
                onClick={reloadAll}
              >
                <RefreshCw size={16} className={refreshing ? "mq-analytics-spin" : undefined} />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {content}

      {account && isOk ? (
        <>
          <AnalyticsPosts
            response={posts.data}
            loading={posts.loading}
            failed={posts.failed}
            accountType={accountType}
            onRetry={posts.reload}
          />
          <AnalyticsAudienceCard
            audience={audience.data}
            loading={audience.loading}
            failed={audience.failed}
            supported={accountType === "ORGANIZATION"}
            onRetry={audience.reload}
          />
        </>
      ) : null}
    </>
  );
}
