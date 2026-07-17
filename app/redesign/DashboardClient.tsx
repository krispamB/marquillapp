"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  BarChart3,
  FileText,
  GalleryHorizontal,
  PenLine,
  Search,
  Video,
} from "lucide-react";
import RedesignShell, { WORKSPACE_SELECTOR_VALUE } from "./Shell";
import MarquillMark from "../../components/brand/MarquillMark";
import LinkedInConnectButton from "./LinkedInConnectButton";
import { API_BASE, readApi } from "./api";
import {
  enrichDashboardPost,
  readAllPostPages,
  sortScheduledPosts,
} from "../lib/dashboard";
import {
  formatRelativeDate,
  formatScheduledDate,
  getFirstName,
  getInitials,
  getPostTitle,
  parseDate,
  titleCase,
} from "./types";
import type {
  ConnectedAccount,
  DashboardInitialData,
  DashboardPost,
  DashboardPostsResponse,
  PaymentUsageResponse,
  PostDetailResponse,
  PostMetricsResponse,
  SubscriptionTier,
  UserProfile,
} from "../lib/types";

function postTypeLabel(post: DashboardPost) {
  return post.type?.toLowerCase().includes("insight") ? "Insight" : "Post";
}

export default function DashboardRedesignClient({
  user,
  connectedAccounts,
  subscription,
  initialDashboardData,
}: {
  user: UserProfile;
  connectedAccounts: ConnectedAccount[];
  primaryAccountId?: string;
  subscription?: SubscriptionTier | null;
  initialDashboardData?: DashboardInitialData;
}) {
  const [selectedAccountId, setSelectedAccountId] = useState(WORKSPACE_SELECTOR_VALUE);
  const [posts, setPosts] = useState<DashboardPost[]>(initialDashboardData?.scheduledPosts ?? []);
  const [upcomingPosts, setUpcomingPosts] = useState<DashboardPost[]>(
    initialDashboardData?.scheduledPosts ?? [],
  );
  const [usage, setUsage] = useState<PaymentUsageResponse["data"] | null>(initialDashboardData?.usage ?? null);
  const [metrics, setMetrics] = useState<PostMetricsResponse["data"] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    initialDashboardData?.errors.length
      ? `Some dashboard data could not be loaded: ${initialDashboardData.errors.join(", ")}.`
      : null,
  );
  const [search, setSearch] = useState("");
  const isWorkspace = selectedAccountId === WORKSPACE_SELECTOR_VALUE;

  const loadDashboard = useCallback(async (signal: AbortSignal) => {
    if (signal.aborted) return;
    if (!selectedAccountId || selectedAccountId === WORKSPACE_SELECTOR_VALUE) {
      setPosts(initialDashboardData?.scheduledPosts ?? []);
      setUpcomingPosts(initialDashboardData?.scheduledPosts ?? []);
      setUsage(initialDashboardData?.usage ?? null);
      setMetrics(null);
      setError(initialDashboardData?.errors.length
        ? `Some dashboard data could not be loaded: ${initialDashboardData.errors.join(", ")}.`
        : null);
      setIsLoading(false);
      return;
    }
    const month = new Date().toISOString().slice(0, 7);
    setIsLoading(true);
    setPosts([]);
    setUpcomingPosts([]);
    setMetrics(null);
    setError(null);

    const accountQuery = `connectedAccount=${encodeURIComponent(selectedAccountId)}`;
    const detailRequests = new Map<string, Promise<PostDetailResponse>>();
    const readPostDetail = (postId: string) => {
      const existing = detailRequests.get(postId);
      if (existing) return existing;
      const request = readApi<PostDetailResponse>(`${API_BASE}/posts/${postId}`, { signal });
      detailRequests.set(postId, request);
      return request;
    };
    const enrichVisiblePosts = async (listedPosts: DashboardPost[], visibleIds: string[]) => {
      const details = await Promise.allSettled(visibleIds.map(readPostDetail));
      const detailsById = new Map(
        details.flatMap((result) =>
          result.status === "fulfilled" && result.value?.data?._id
            ? [[result.value.data._id, result.value.data] as const]
            : []),
      );
      return listedPosts.map((post) =>
        enrichDashboardPost(post, detailsById.get(post._id)));
    };

    const postsRequest = readApi<DashboardPostsResponse>(
          `${API_BASE}/posts?${accountQuery}&month=${month}&page=1`,
          { signal },
        ).then(async (response) => {
          const listedPosts = Array.isArray(response?.data) ? response.data : [];
          const visibleIds = [...listedPosts]
            .sort((left, right) =>
              (parseDate(right.updatedAt ?? right.createdAt)?.getTime() ?? 0) -
              (parseDate(left.updatedAt ?? left.createdAt)?.getTime() ?? 0))
            .slice(0, 3)
            .map((post) => post._id);
          const enrichedPosts = await enrichVisiblePosts(listedPosts, visibleIds);
          if (!signal.aborted) setPosts(enrichedPosts);
        });

    const scheduledRequest = readAllPostPages((page) =>
          readApi<DashboardPostsResponse>(
            `${API_BASE}/posts?${accountQuery}&status=SCHEDULED&page=${page}`,
            { signal },
          ),
        ).then(async (responsePosts) => {
          const listedPosts = sortScheduledPosts(responsePosts);
          const visibleIds = listedPosts.slice(0, 3).map((post) => post._id);
          const enrichedPosts = await enrichVisiblePosts(listedPosts, visibleIds);
          if (!signal.aborted) setUpcomingPosts(enrichedPosts);
        });

    const metricsRequest = readApi<PostMetricsResponse>(
      `${API_BASE}/posts/metrics/${encodeURIComponent(selectedAccountId)}`,
      { signal },
    ).then((response) => {
      if (!signal.aborted) setMetrics(response?.data ?? null);
    });

    const [postsResult, scheduledResult, metricsResult] = await Promise.allSettled([
      postsRequest,
      scheduledRequest,
      metricsRequest,
    ]);

    if (signal.aborted) return;

    const requestErrors: string[] = [];
    if (postsResult.status === "rejected") requestErrors.push("recent posts");
    if (scheduledResult.status === "rejected") requestErrors.push("scheduled posts");
    if (metricsResult.status === "rejected") requestErrors.push("post metrics");

    setError(requestErrors.length
      ? `Some dashboard data could not be loaded: ${requestErrors.join(", ")}.`
      : null);
    setIsLoading(false);
  }, [initialDashboardData, selectedAccountId]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => void loadDashboard(controller.signal));
    return () => controller.abort();
  }, [loadDashboard]);

  const recentPosts = useMemo(
    () => [...posts].sort((left, right) =>
      (parseDate(right.updatedAt ?? right.createdAt)?.getTime() ?? 0) -
      (parseDate(left.updatedAt ?? left.createdAt)?.getTime() ?? 0)),
    [posts],
  );
  const scheduled = useMemo(() => sortScheduledPosts(upcomingPosts), [upcomingPosts]);
  const failed = useMemo(
    () => posts.filter((post) => String(post.status).toUpperCase() === "FAILED"),
    [posts],
  );
  const filteredPosts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return recentPosts.filter((post) => !query || String(post.content ?? "").toLowerCase().includes(query));
  }, [recentPosts, search]);
  const creditUsage = usage?.usage?.credits ?? null;
  const artifactCounts = usage?.artifactsCreated;
  const artifactsCreated = artifactCounts
    ? artifactCounts.posts + artifactCounts.polls + artifactCounts.documents
    : null;
  const comparison = initialDashboardData?.comparison ?? null;
  const currentMonthCount = metrics
    ? metrics.monthly?.find((item) => item.month === new Date().toISOString().slice(0, 7))?.count ?? 0
    : null;
  const firstScheduled = scheduled[0];
  const visibleWorkspaceAccounts = connectedAccounts.slice(0, 3);
  const hiddenWorkspaceAccountCount = Math.max(0, connectedAccounts.length - visibleWorkspaceAccounts.length);

  return (
    <RedesignShell
      user={user}
      accounts={connectedAccounts}
      selectedAccountId={selectedAccountId}
      onSelectAccount={setSelectedAccountId}
      includeWorkspaceOption
      subscription={subscription}
      initialUsage={usage}
      active="dashboard"
      title="Dashboard"
      topbarExtra={!isWorkspace ? (
        <label className="mq-search-field mq-search-desktop">
          <Search size={15} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search posts…" />
        </label>
      ) : null}
    >
      <div className="mq-page-heading">
        <div>
          <h1>Good morning, {getFirstName(user.name)}.</h1>
          {isWorkspace ? (
            <p>Here&apos;s what&apos;s happening across your workspace.</p>
          ) : (
            <p>
              Here&apos;s what&apos;s happening for this LinkedIn account.
            </p>
          )}
        </div>
        <time className="mq-mono">{new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date())}</time>
      </div>

      {!isWorkspace ? (
        <Link href="/posts/new" className="mq-ask-card">
          <MarquillMark size={34} theme="light" className="mq-ask-mark-svg" title="" />
          <span className="mq-ask-placeholder">Ask Mark to write a post about our Series A…<span className="mq-caret" /></span>
          <span className="mq-chip"><PenLine size={13} /> Quick</span>
          <span className="mq-chip mq-chip-desktop"><Video size={13} /> Insight</span>
          <span className="mq-primary-icon"><ArrowUpRight size={18} /></span>
        </Link>
      ) : null}

      {error ? <div className="mq-alert mq-alert-error">{error}</div> : null}
      {!connectedAccounts.length ? (
        <div className="mq-alert">
          Connect a LinkedIn account to start drafting and publishing with Mark. <LinkedInConnectButton className="mq-inline-connect">Connect account</LinkedInConnectButton>
        </div>
      ) : null}

      {isWorkspace ? (
        <>
          <section className="mq-stat-grid" aria-label="Workspace metrics">
            <div className="mq-card mq-stat-card">
              <span className="mq-label">Credits left</span>
              <div className="mq-stat-value-row"><strong>{creditUsage?.remaining.toLocaleString() ?? "—"}</strong><span>/ {creditUsage?.limit.toLocaleString() ?? "—"}</span></div>
              <div className="mq-progress"><span style={{ width: `${creditUsage?.limit ? Math.min(100, (creditUsage.remaining / creditUsage.limit) * 100) : 0}%` }} /></div>
            </div>
            <div className="mq-card mq-stat-card">
              <span className="mq-label">Content created</span>
              <div className="mq-stat-value-row"><strong>{artifactsCreated ?? "—"}</strong><span>this cycle</span></div>
              <span className="mq-stat-note">{artifactCounts ? `${artifactCounts.posts} posts · ${artifactCounts.documents} documents · ${artifactCounts.polls} polls` : "Usage unavailable"}</span>
            </div>
            <div className="mq-card mq-stat-card">
              <span className="mq-label">Posts created</span>
              <div className="mq-stat-value-row"><strong>{comparison?.current.count ?? "—"}</strong><span>this month</span></div>
              <span className={`mq-stat-note ${comparison && comparison.difference >= 0 ? "mq-positive" : ""}`}>
                {comparison ? `${comparison.difference >= 0 ? "↗" : "↘"} ${Math.abs(comparison.difference)} vs last month${comparison.percentageChange === null ? "" : ` (${Math.abs(comparison.percentageChange)}%)`}` : "Comparison unavailable"}
              </span>
            </div>
            <div className="mq-card mq-stat-card mq-connected-account-card">
              <span className="mq-label">Connected Accounts</span>
              <div className="mq-stat-value-row"><strong>{connectedAccounts.length}</strong></div>
              <div className="mq-connected-account-summary">
                <span>LinkedIn Pages</span>
                {visibleWorkspaceAccounts.length ? (
                  <span className="mq-connected-account-avatars" aria-label={`${connectedAccounts.length} connected LinkedIn ${connectedAccounts.length === 1 ? "account" : "accounts"}`}>
                    {visibleWorkspaceAccounts.map((account) => (
                      <span className="mq-connected-account-avatar" key={account.id} title={account.displayName ?? "LinkedIn account"}>
                        <span aria-hidden="true">
                          {getInitials(account.displayName ?? account.profile?.localizedFirstName ?? "LinkedIn", account.vanityName)}
                        </span>
                        {account.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={account.avatarUrl}
                            alt=""
                            onError={(event) => event.currentTarget.remove()}
                          />
                        ) : null}
                      </span>
                    ))}
                    {hiddenWorkspaceAccountCount ? <span className="mq-connected-account-more">+{hiddenWorkspaceAccountCount}</span> : null}
                  </span>
                ) : null}
              </div>
            </div>
          </section>

          <section className="mq-two-column mq-workspace-panels">
            <div className="mq-card mq-list-card">
              <div className="mq-card-heading"><span className="mq-title">Quick actions</span></div>
              <Link href="/artifacts/new?type=POST" className="mq-quick-action-row">
                <span className="mq-row-icon"><FileText size={17} /></span>
                <span className="mq-row-copy"><strong>Post</strong><small>Create a LinkedIn post with Mark</small></span>
                <ArrowUpRight className="mq-row-arrow" size={16} />
              </Link>
              <Link href="/artifacts/new?type=POLL" className="mq-quick-action-row">
                <span className="mq-row-icon"><BarChart3 size={17} /></span>
                <span className="mq-row-copy"><strong>Poll</strong><small>Create a poll for your audience</small></span>
                <ArrowUpRight className="mq-row-arrow" size={16} />
              </Link>
              <Link href="/artifacts/new?type=DOCUMENT" className="mq-quick-action-row">
                <span className="mq-row-icon"><GalleryHorizontal size={17} /></span>
                <span className="mq-row-copy"><strong>Carousel</strong><small>Turn an idea into a slide deck</small></span>
                <ArrowUpRight className="mq-row-arrow" size={16} />
              </Link>
            </div>

            <div className="mq-card mq-list-card">
              <div className="mq-card-heading"><span className="mq-title">Up next</span><Link href="/calendar">Calendar <ArrowUpRight size={14} /></Link></div>
              {!scheduled.length ? <p className="mq-empty">No upcoming posts.</p> : null}
              {scheduled.slice(0, 3).map((post) => {
                const date = parseDate(post.scheduledAt);
                const accountName = post.connectedAccountName
                  ?? connectedAccounts.find((account) => account.id === post.connectedAccount)?.displayName
                  ?? "LinkedIn account";
                return (
                  <Link href={`/posts/${post._id}/edit`} className="mq-schedule-row" key={post._id}>
                    <span className="mq-date-block"><b>{date?.toLocaleDateString(undefined, { month: "short" }) ?? "—"}</b><strong>{date?.getDate() ?? "—"}</strong></span>
                    <span className="mq-row-copy"><strong>{getPostTitle(post.content)}</strong><small><span className="mq-live-dot" />{formatScheduledDate(post.scheduledAt)} · {accountName}</small></span>
                  </Link>
                );
              })}
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="mq-stat-grid" aria-label="Overview metrics">
            <div className="mq-card mq-stat-card">
              <span className="mq-label">Credits left</span>
              <div className="mq-stat-value-row"><strong>{creditUsage?.remaining.toLocaleString() ?? "—"}</strong><span>/ {creditUsage?.limit.toLocaleString() ?? "—"}</span></div>
              <div className="mq-progress"><span style={{ width: `${creditUsage?.limit ? Math.min(100, (creditUsage.remaining / creditUsage.limit) * 100) : 0}%` }} /></div>
            </div>
            <div className="mq-card mq-stat-card">
              <span className="mq-label">Scheduled</span>
              <div className="mq-stat-value-row"><strong>{isLoading ? "…" : scheduled.length}</strong><span>queued</span></div>
              <span className="mq-stat-note">{firstScheduled ? `Next: ${formatScheduledDate(firstScheduled.scheduledAt)}` : "Nothing queued yet"}</span>
            </div>
            <div className="mq-card mq-stat-card">
              <span className="mq-label">Posts created</span>
              <div className="mq-stat-value-row"><strong>{isLoading ? "…" : currentMonthCount ?? "—"}</strong><span>this month</span></div>
              <span className="mq-stat-note">All post statuses</span>
            </div>
            <div className="mq-card mq-stat-card">
              <span className="mq-label">Failed</span>
              <div className="mq-stat-value-row"><strong>{isLoading ? "…" : failed.length}</strong><span>this month</span></div>
              <span className="mq-stat-note">Open Posts to retry</span>
            </div>
          </section>

          <section className="mq-two-column">
            <div className="mq-card mq-list-card">
              <div className="mq-card-heading"><span className="mq-title">Recent posts</span><Link href="/posts">View all <ArrowUpRight size={14} /></Link></div>
              {isLoading ? <p className="mq-empty">Loading posts…</p> : null}
              {!isLoading && !filteredPosts.length ? <p className="mq-empty">No posts found for this account.</p> : null}
              {filteredPosts.slice(0, 3).map((post) => (
                <Link href={`/posts/${post._id}/edit`} className="mq-list-row" key={post._id}>
                  <span className="mq-row-icon"><FileText size={16} /></span>
                  <span className="mq-row-copy"><strong>{getPostTitle(post.content)}</strong><small><span className="mq-tag">{titleCase(post.status ?? postTypeLabel(post))}</span>{formatRelativeDate(post.updatedAt ?? post.createdAt)}</small></span>
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
            <p>{creditUsage ? `${creditUsage.remaining.toLocaleString()} credits remaining this cycle.` : "Usage data will appear here when the billing service responds."}</p>
            <Link href="/billing" className="mq-secondary-button">View billing <ArrowUpRight size={15} /></Link>
          </section>
        </>
      )}
    </RedesignShell>
  );
}
