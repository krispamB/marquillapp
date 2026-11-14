"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  BarChart3,
  FileText,
  GalleryHorizontal,
} from "lucide-react";
import RedesignShell, { WORKSPACE_SELECTOR_VALUE } from "./Shell";
import LinkedInConnectButton from "./LinkedInConnectButton";
import AnalyticsPanel from "./AnalyticsPanel";
import { useAccountSnapshots, describeSnapshot } from "./useAccountSnapshots";
import { sortScheduledPosts } from "../lib/dashboard";
import {
  formatScheduledDate,
  getFirstName,
  getInitials,
  getPostTitle,
  parseDate,
} from "./types";
import type {
  AnalyticsRangeKey,
  ConnectedAccount,
  DashboardInitialData,
  DashboardPost,
  SubscriptionTier,
  UserProfile,
} from "../lib/types";

const WORKSPACE_DESCRIPTION = "App usage and credits";

/** The upcoming scheduled posts, three at most, in the order they were given. */
function UpNextCard({
  posts,
  accounts,
  emptyText,
}: {
  posts: DashboardPost[];
  accounts: ConnectedAccount[];
  emptyText: string;
}) {
  return (
    <div className="mq-card mq-list-card">
      <div className="mq-card-heading"><span className="mq-title">Up next</span><Link href="/calendar">Calendar <ArrowUpRight size={14} /></Link></div>
      {!posts.length ? <p className="mq-empty">{emptyText}</p> : null}
      {posts.slice(0, 3).map((post) => {
        const date = parseDate(post.scheduledAt);
        const accountName = post.connectedAccountName
          ?? accounts.find((account) => account.id === post.connectedAccount)?.displayName
          ?? "LinkedIn account";
        return (
          <Link href={`/posts/${post._id}/edit`} className="mq-schedule-row" key={post._id}>
            <span className="mq-date-block"><b>{date?.toLocaleDateString(undefined, { month: "short" }) ?? "—"}</b><strong>{date?.getDate() ?? "—"}</strong></span>
            <span className="mq-row-copy"><strong>{post.title?.trim() || getPostTitle(post.content)}</strong><small><span className="mq-live-dot" />{formatScheduledDate(post.scheduledAt)} · {accountName}</small></span>
          </Link>
        );
      })}
    </div>
  );
}

/** Keeps the scope and range in the address bar so a reload lands on the same view. */
function writeScopeToUrl(accountId: string, range: AnalyticsRangeKey) {
  try {
    const query = accountId === WORKSPACE_SELECTOR_VALUE ? "" : `?account=${encodeURIComponent(accountId)}&range=${range}`;
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${query}`);
  } catch {
    // The URL is a convenience; the view still applies.
  }
}

export default function DashboardRedesignClient({
  user,
  connectedAccounts,
  subscription,
  initialDashboardData,
  initialRange,
  initialAccountId,
}: {
  user: UserProfile;
  connectedAccounts: ConnectedAccount[];
  primaryAccountId?: string;
  subscription?: SubscriptionTier | null;
  initialDashboardData?: DashboardInitialData;
  initialRange?: AnalyticsRangeKey;
  initialAccountId?: string;
}) {
  const [selectedAccountId, setSelectedAccountId] = useState(() =>
    initialAccountId && connectedAccounts.some((account) => account.id === initialAccountId)
      ? initialAccountId
      : WORKSPACE_SELECTOR_VALUE,
  );
  const [range, setRange] = useState<AnalyticsRangeKey>(initialRange ?? "28d");
  const selectAccount = useCallback((accountId: string) => {
    setSelectedAccountId(accountId);
    writeScopeToUrl(accountId, range);
  }, [range]);
  const changeRange = useCallback((next: AnalyticsRangeKey) => {
    setRange(next);
    writeScopeToUrl(selectedAccountId, next);
  }, [selectedAccountId]);
  const { snapshots, load: loadSnapshots } = useAccountSnapshots(connectedAccounts);
  const accountDescriptions = useMemo(() => {
    const descriptions: Record<string, string> = { [WORKSPACE_SELECTOR_VALUE]: WORKSPACE_DESCRIPTION };
    for (const account of connectedAccounts) {
      const text = describeSnapshot(snapshots[account.id]);
      if (text) descriptions[account.id] = text;
    }
    return descriptions;
  }, [connectedAccounts, snapshots]);
  const isWorkspace = selectedAccountId === WORKSPACE_SELECTOR_VALUE;
  const usage = initialDashboardData?.usage ?? null;
  const error = initialDashboardData?.errors.length
    ? `Some dashboard data could not be loaded: ${initialDashboardData.errors.join(", ")}.`
    : null;

  const scheduled = useMemo(
    () => sortScheduledPosts(initialDashboardData?.scheduledPosts ?? []),
    [initialDashboardData],
  );
  const accountScheduled = useMemo(
    () => scheduled.filter((post) => post.connectedAccount === selectedAccountId),
    [scheduled, selectedAccountId],
  );
  const creditUsage = usage?.usage?.credits ?? null;
  const artifactCounts = usage?.artifactsCreated;
  const artifactsCreated = artifactCounts
    ? artifactCounts.posts + artifactCounts.polls + artifactCounts.documents
    : null;
  const comparison = initialDashboardData?.comparison ?? null;
  const visibleWorkspaceAccounts = connectedAccounts.slice(0, 3);
  const hiddenWorkspaceAccountCount = Math.max(0, connectedAccounts.length - visibleWorkspaceAccounts.length);

  return (
    <RedesignShell
      user={user}
      accounts={connectedAccounts}
      selectedAccountId={selectedAccountId}
      onSelectAccount={selectAccount}
      accountDescriptions={accountDescriptions}
      onAccountMenuIntent={loadSnapshots}
      includeWorkspaceOption
      subscription={subscription}
      initialUsage={usage}
      active="dashboard"
      title="Dashboard"
    >
      {isWorkspace ? (
        <div className="mq-page-heading">
          <div>
            <h1>Good morning, {getFirstName(user.name)}.</h1>
            <p>Here&apos;s what&apos;s happening across your workspace.</p>
          </div>
          <time className="mq-mono">{new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date())}</time>
        </div>
      ) : null}

      {error && isWorkspace ? <div className="mq-alert mq-alert-error">{error}</div> : null}
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
              <span className="mq-stat-note mq-stat-note-clamp" title={artifactCounts ? `${artifactCounts.posts} posts · ${artifactCounts.documents} documents · ${artifactCounts.polls} polls` : undefined}>{artifactCounts ? `${artifactCounts.posts} posts · ${artifactCounts.documents} docs · ${artifactCounts.polls} polls` : "Usage unavailable"}</span>
            </div>
            <div className="mq-card mq-stat-card">
              <span className="mq-label">Posts created</span>
              <div className="mq-stat-value-row"><strong>{comparison?.current.count ?? "—"}</strong><span>this month</span></div>
              <span className={`mq-stat-note ${comparison && comparison.difference >= 0 ? "mq-positive" : ""}`}>
                {comparison ? `${comparison.difference >= 0 ? "↗" : "↘"} ${Math.abs(comparison.difference)} vs last month${comparison.percentageChange === null ? "" : ` (${Math.abs(comparison.percentageChange)}%)`}` : "Comparison unavailable"}
              </span>
            </div>
            <div className="mq-card mq-stat-card mq-connected-account-card">
              <span className="mq-label">Connected accounts</span>
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

            <UpNextCard posts={scheduled} accounts={connectedAccounts} emptyText="No upcoming posts." />
          </section>
        </>
      ) : (
        <AnalyticsPanel
          connectedAccounts={connectedAccounts}
          selectedAccountId={selectedAccountId}
          initialRange={range}
          onRangeChange={changeRange}
          fallback={<UpNextCard posts={accountScheduled} accounts={connectedAccounts} emptyText="No upcoming posts for this account." />}
        />
      )}
    </RedesignShell>
  );
}
