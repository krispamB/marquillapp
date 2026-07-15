"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, FileText, PenLine, Search, Video } from "lucide-react";
import RedesignShell from "./Shell";
import MarquillMark from "../../components/brand/MarquillMark";
import LinkedInConnectButton from "./LinkedInConnectButton";
import { API_BASE, readApi } from "./api";
import {
  formatRelativeDate,
  formatScheduledDate,
  getFirstName,
  getPostTitle,
  normalizeStatus,
  parseDate,
  titleCase,
} from "./types";
import type {
  ConnectedAccount,
  DashboardPost,
  DashboardPostsResponse,
  PaymentUsageResponse,
  PostMetricsResponse,
  UserProfile,
} from "../lib/types";

function findMetric(usage: PaymentUsageResponse["data"] | null, names: string[]) {
  if (!usage?.usage) return null;
  const expected = new Set(names.map((name) => name.replace(/[_-]/g, "").toLowerCase()));
  const entry = Object.entries(usage.usage).find(([key]) => expected.has(key.replace(/[_-]/g, "").toLowerCase()));
  return entry?.[1] ?? null;
}

function postTypeLabel(post: DashboardPost) {
  return post.type?.toLowerCase().includes("insight") ? "Insight" : "Post";
}

export default function DashboardRedesignClient({
  user,
  connectedAccounts,
  primaryAccountId,
}: {
  user: UserProfile;
  connectedAccounts: ConnectedAccount[];
  primaryAccountId?: string;
}) {
  const [selectedAccountId, setSelectedAccountId] = useState(primaryAccountId ?? connectedAccounts[0]?.id);
  const [posts, setPosts] = useState<DashboardPost[]>([]);
  const [usage, setUsage] = useState<PaymentUsageResponse["data"] | null>(null);
  const [metrics, setMetrics] = useState<PostMetricsResponse["data"] | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(selectedAccountId));
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const loadDashboard = useCallback(async (signal: AbortSignal) => {
    if (!selectedAccountId) return;
    const month = new Date().toISOString().slice(0, 7);
    setIsLoading(true);
    setError(null);

    try {
      const [postsResponse, usageResponse, metricsResponse] = await Promise.all([
      readApi<DashboardPostsResponse>(
        `${API_BASE}/posts?accountConnected=${encodeURIComponent(selectedAccountId)}&month=${month}`,
          { signal },
      ),
        readApi<PaymentUsageResponse>(`${API_BASE}/payment/usage`, { signal }),
      readApi<PostMetricsResponse>(`${API_BASE}/posts/metrics/${encodeURIComponent(selectedAccountId)}`, {
          signal,
      }),
      ]);
      setPosts(Array.isArray(postsResponse?.data) ? postsResponse.data : []);
      setUsage(usageResponse?.data ?? null);
      setMetrics(metricsResponse?.data ?? null);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "Unable to load dashboard data.");
    } finally {
      if (!signal.aborted) setIsLoading(false);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadDashboard(controller.signal);
    return () => controller.abort();
  }, [loadDashboard]);

  const drafts = useMemo(
    () => posts.filter((post) => normalizeStatus(post.status) === "DRAFT"),
    [posts],
  );
  const scheduled = useMemo(
    () =>
      posts
        .filter((post) => normalizeStatus(post.status) === "SCHEDULED")
        .sort((a, b) => (parseDate(a.scheduledAt)?.getTime() ?? 0) - (parseDate(b.scheduledAt)?.getTime() ?? 0)),
    [posts],
  );
  const published = useMemo(
    () => posts.filter((post) => normalizeStatus(post.status) === "PUBLISHED"),
    [posts],
  );
  const filteredDrafts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return drafts.filter((post) => !query || String(post.content ?? "").toLowerCase().includes(query));
  }, [drafts, search]);
  const aiUsage = findMetric(usage, ["posts_generated", "aiposts", "ai_posts", "posts"]);
  const currentMonthCount = metrics?.monthly?.at(-1)?.count ?? published.length;
  const firstScheduled = scheduled[0];

  return (
    <RedesignShell
      user={user}
      accounts={connectedAccounts}
      selectedAccountId={selectedAccountId}
      onSelectAccount={setSelectedAccountId}
      active="dashboard"
      title="Dashboard"
      topbarExtra={
        <label className="mq-search-field mq-search-desktop">
          <Search size={15} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search posts…" />
        </label>
      }
    >
      <div className="mq-page-heading">
        <div>
          <h1>Good morning, {getFirstName(user.name)}.</h1>
          <p>
            Here&apos;s what Mark has queued. You have <strong>{drafts.length} drafts</strong> waiting for review.
          </p>
        </div>
        <time className="mq-mono">{new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date())}</time>
      </div>

      <Link href="/posts/new" className="mq-ask-card">
        <MarquillMark size={34} theme="light" className="mq-ask-mark-svg" title="" />
        <span className="mq-ask-placeholder">Ask Mark to write a post about our Series A…<span className="mq-caret" /></span>
        <span className="mq-chip"><PenLine size={13} /> Quick</span>
        <span className="mq-chip mq-chip-desktop"><Video size={13} /> Insight</span>
        <span className="mq-primary-icon"><ArrowUpRight size={18} /></span>
      </Link>

      {error ? <div className="mq-alert mq-alert-error">{error}</div> : null}
      {!connectedAccounts.length ? (
        <div className="mq-alert">
          Connect a LinkedIn account to start drafting and publishing with Mark. <LinkedInConnectButton className="mq-inline-connect">Connect account</LinkedInConnectButton>
        </div>
      ) : null}

      <section className="mq-stat-grid" aria-label="Overview metrics">
        <div className="mq-card mq-stat-card">
          <span className="mq-label">AI posts this month</span>
          <div className="mq-stat-value-row"><strong>{aiUsage?.used ?? (isLoading ? "…" : currentMonthCount)}</strong><span>/ {aiUsage?.limit ?? "—"}</span></div>
          <div className="mq-progress"><span style={{ width: `${aiUsage?.limit ? Math.min(100, (aiUsage.used / aiUsage.limit) * 100) : 0}%` }} /></div>
        </div>
        <div className="mq-card mq-stat-card">
          <span className="mq-label">Scheduled</span>
          <div className="mq-stat-value-row"><strong>{isLoading ? "…" : scheduled.length}</strong><span>queued</span></div>
          <span className="mq-stat-note">{firstScheduled ? `Next: ${formatScheduledDate(firstScheduled.scheduledAt)}` : "Nothing queued yet"}</span>
        </div>
        <div className="mq-card mq-stat-card">
          <span className="mq-label">Published</span>
          <div className="mq-stat-value-row"><strong>{isLoading ? "…" : published.length}</strong><span>this month</span></div>
          <span className="mq-stat-note mq-positive">↗ Live post count</span>
        </div>
        <div className="mq-card mq-stat-card">
          <span className="mq-label">Avg. engagement</span>
          <div className="mq-stat-value-row"><strong>—</strong></div>
          <span className="mq-stat-note">Analytics endpoint not connected</span>
        </div>
      </section>

      <section className="mq-two-column">
        <div className="mq-card mq-list-card">
          <div className="mq-card-heading"><span className="mq-title">Recent drafts</span><Link href="/posts?status=DRAFT">View all <ArrowUpRight size={14} /></Link></div>
          {isLoading ? <p className="mq-empty">Loading drafts…</p> : null}
          {!isLoading && !filteredDrafts.length ? <p className="mq-empty">No drafts found for this account.</p> : null}
          {filteredDrafts.slice(0, 3).map((post) => (
            <Link href={`/posts/${post._id}/edit`} className="mq-list-row" key={post._id}>
              <span className="mq-row-icon"><FileText size={16} /></span>
              <span className="mq-row-copy"><strong>{getPostTitle(post.content)}</strong><small><span className="mq-tag">{postTypeLabel(post)}</span>{formatRelativeDate(post.updatedAt ?? post.createdAt)}</small></span>
              <ArrowUpRight className="mq-row-arrow" size={16} />
            </Link>
          ))}
        </div>

        <div className="mq-card mq-list-card">
          <div className="mq-card-heading"><span className="mq-title">Up next</span><Link href="/calendar">Calendar <ArrowUpRight size={14} /></Link></div>
          {!isLoading && !scheduled.length ? <p className="mq-empty">No upcoming posts.</p> : null}
          {scheduled.slice(0, 3).map((post) => {
            const date = parseDate(post.scheduledAt);
            return (
              <Link href={`/posts/${post._id}/edit`} className="mq-schedule-row" key={post._id}>
                <span className="mq-date-block"><b>{date?.toLocaleDateString(undefined, { month: "short" }) ?? "—"}</b><strong>{date?.getDate() ?? "—"}</strong></span>
                <span className="mq-row-copy"><strong>{getPostTitle(post.content)}</strong><small><span className="mq-live-dot" />{formatScheduledDate(post.scheduledAt)}</small></span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="mq-card mq-footnote-card">
        <div><span className="mq-eyebrow">This workspace</span><h2>{titleCase(usage?.tier?.name ?? user.tier?.name ?? "Free")} plan</h2></div>
        <p>{aiUsage ? `${aiUsage.remaining} AI posts remaining this cycle.` : "Usage data will appear here when the billing service responds."}</p>
        <Link href="/billing" className="mq-secondary-button">View billing <ArrowUpRight size={15} /></Link>
      </section>
    </RedesignShell>
  );
}
