"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CalendarClock, ChevronDown, ChevronLeft, ChevronRight, Pencil, Plus, Search, Send, Trash2, X } from "lucide-react";
import RedesignShell from "./Shell";
import { API_BASE, jsonRequest, readApi } from "./api";
import DeleteConfirmModal from "./DeleteConfirmModal";
import PostRowMenu from "./PostRowMenu";
import SchedulePicker, { getDefaultScheduleDate, localDateTimeValue } from "./SchedulePicker";
import { formatRelativeDate, formatScheduledDate, getPostTitle, normalizeStatus, parseDate, toYearMonth } from "./types";
import type { ConnectedAccount, DashboardPost, DashboardPostsResponse, SubscriptionTier, UserProfile } from "../lib/types";
import {
  getLinkedInAccountAccessById,
  LINKEDIN_ACCESS_EXPIRED_MESSAGE,
} from "./linkedinAccess";

type PostFilter = "ALL" | "DRAFT" | "SCHEDULED" | "PUBLISHED";

const filterLabels: Array<{ key: PostFilter; label: string }> = [
  { key: "ALL", label: "All" },
  { key: "DRAFT", label: "Drafts" },
  { key: "SCHEDULED", label: "Scheduled" },
  { key: "PUBLISHED", label: "Published" },
];

function compactTitle(post: DashboardPost) {
  const title = post.title?.trim() || getPostTitle(post.content);
  return title.length > 150 ? `${title.slice(0, 147)}…` : title;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(value: string) {
  const [year, month] = value.split("-");
  const name = MONTH_NAMES[Number(month) - 1];
  return name && year ? `${name} ${year}` : "Month";
}

function postKind(post: DashboardPost) {
  if (post.type?.toLowerCase().includes("insight")) return "Insight";
  return "Post";
}

export default function PostsRedesignClient({
  user,
  connectedAccounts,
  primaryAccountId,
  subscription,
}: {
  user: UserProfile;
  connectedAccounts: ConnectedAccount[];
  primaryAccountId?: string;
  subscription?: SubscriptionTier | null;
}) {
  const [selectedAccountId, setSelectedAccountId] = useState(primaryAccountId ?? connectedAccounts[0]?.id);
  const [selectedMonth, setSelectedMonth] = useState(toYearMonth(new Date()));
  const [posts, setPosts] = useState<DashboardPost[]>([]);
  const [filter, setFilter] = useState<PostFilter>("ALL");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [schedulePostId, setSchedulePostId] = useState<string | null>(null);
  const [scheduleValue, setScheduleValue] = useState("");
  const [deletePostId, setDeletePostId] = useState<string | null>(null);

  const loadPosts = useCallback(async () => {
    if (!selectedAccountId) {
      setPosts([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await readApi<DashboardPostsResponse>(
        `${API_BASE}/posts?accountConnected=${encodeURIComponent(selectedAccountId)}&month=${selectedMonth}`,
      );
      setPosts(Array.isArray(response?.data) ? response.data : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load posts.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedAccountId, selectedMonth]);

  useEffect(() => { void loadPosts(); }, [loadPosts]);
  useEffect(() => { if (searchOpen) searchInputRef.current?.focus(); }, [searchOpen]);

  const counts = useMemo(() => {
    return posts.reduce<Record<PostFilter, number>>((result, post) => {
      const status = normalizeStatus(post.status);
      result.ALL += 1;
      result[status] += 1;
      return result;
    }, { ALL: 0, DRAFT: 0, SCHEDULED: 0, PUBLISHED: 0 });
  }, [posts]);

  const visiblePosts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return posts
      .filter((post) => filter === "ALL" || normalizeStatus(post.status) === filter)
      .filter((post) => !query || `${post.title ?? ""}\n${post.content ?? ""}`.toLowerCase().includes(query))
      .sort((a, b) => (parseDate(b.updatedAt ?? b.scheduledAt ?? b.createdAt)?.getTime() ?? 0) - (parseDate(a.updatedAt ?? a.scheduledAt ?? a.createdAt)?.getTime() ?? 0));
  }, [filter, posts, search]);
  // A label every row shares says nothing; show the kind only when the list mixes them.
  const showKind = new Set(visiblePosts.map(postKind)).size > 1;

  async function runAction(postId: string, action: "publish" | "delete") {
    const post = posts.find((item) => item._id === postId);
    if (action === "publish" && !getLinkedInAccountAccessById(post?.connectedAccount, connectedAccounts)?.isUsable) {
      setError(LINKEDIN_ACCESS_EXPIRED_MESSAGE);
      return false;
    }
    setActionId(postId);
    setError(null);
    setActionMessage(null);
    try {
      await readApi(
        `${API_BASE}/posts/${postId}${action === "publish" ? "/publish" : ""}`,
        action === "publish" ? { method: "POST" } : { method: "DELETE" },
      );
      setActionMessage(action === "publish" ? "Post published." : "Post deleted.");
      await loadPosts();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Unable to ${action} post.`);
      return false;
    } finally {
      setActionId(null);
    }
  }

  async function schedulePost() {
    if (!schedulePostId || !scheduleValue) return;
    const post = posts.find((item) => item._id === schedulePostId);
    if (!getLinkedInAccountAccessById(post?.connectedAccount, connectedAccounts)?.isUsable) {
      setError(LINKEDIN_ACCESS_EXPIRED_MESSAGE);
      return;
    }
    const scheduledDate = new Date(scheduleValue);
    if (Number.isNaN(scheduledDate.getTime())) {
      setError("Pick a valid date and time before scheduling.");
      return;
    }
    if (scheduledDate.getTime() < Date.now() + 5 * 60 * 1000) {
      setError("Choose a time at least 5 minutes in the future.");
      return;
    }
    setActionId(schedulePostId);
    try {
      await readApi(`${API_BASE}/posts/${schedulePostId}/schedule`, jsonRequest({ scheduledTime: scheduledDate.toISOString() }, { method: "POST" }));
      setActionMessage("Post scheduled.");
      setSchedulePostId(null);
      setScheduleValue("");
      await loadPosts();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to schedule post.");
    } finally {
      setActionId(null);
    }
  }

  return (
    <RedesignShell
      user={user}
      accounts={connectedAccounts}
      selectedAccountId={selectedAccountId}
      onSelectAccount={setSelectedAccountId}
      subscription={subscription}
      active="posts"
      title="Posts"
      topbarExtra={
        <label className="mq-search-field mq-search-desktop">
          <Search size={15} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search posts…" />
        </label>
      }
    >
      <div className="mq-page-heading mq-page-heading-compact">
        <div><span className="mq-eyebrow">Your content workspace</span><h1 className="mq-h1-dup">Posts</h1><p>Draft, schedule, and publish from one calm queue.</p></div>
        <Link href="/posts/new" className="mq-primary-button"><Plus size={16} /> New post</Link>
      </div>

      <div className="mq-toolbar">
        <div className="mq-segmented" role="tablist" aria-label="Post status">
          {filterLabels.map((item) => (
            <button key={item.key} type="button" role="tab" aria-selected={filter === item.key} className={filter === item.key ? "is-active" : ""} onClick={() => setFilter(item.key)}>
              {item.label} <span>{counts[item.key]}</span>
            </button>
          ))}
        </div>
        <div className="mq-toolbar-filters">
          <label className="mq-filter-select mq-month-filter">
            <span className="mq-month-label" aria-hidden="true">{monthLabel(selectedMonth)}<ChevronDown size={14} /></span>
            <input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} aria-label="Filter by month" />
          </label>
          <button type="button" className="mq-icon-button mq-search-toggle" aria-label="Search posts" aria-expanded={searchOpen || Boolean(search)} onClick={() => setSearchOpen((open) => !open)}><Search size={16} /></button>
          <label className={`mq-filter-select mq-search-mobile${searchOpen || search ? " is-open" : ""}`}>
            <Search size={14} />
            <input ref={searchInputRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search posts…" />
            <button type="button" className="mq-search-close" aria-label="Close search" onClick={() => { setSearch(""); setSearchOpen(false); }}><X size={14} /></button>
          </label>
        </div>
      </div>

      {error ? <div className="mq-alert mq-alert-error">{error}</div> : null}
      {actionMessage ? <div className="mq-alert mq-alert-success">{actionMessage}</div> : null}

      <div className="mq-card mq-post-list">
        {isLoading ? <p className="mq-empty">Loading posts…</p> : null}
        {!isLoading && !visiblePosts.length ? <p className="mq-empty">No posts match this view.</p> : null}
        {visiblePosts.map((post) => {
          const status = normalizeStatus(post.status);
          const dateLabel = status === "SCHEDULED" ? formatScheduledDate(post.scheduledAt) : formatRelativeDate(post.updatedAt ?? post.createdAt);
          const accountAccess = getLinkedInAccountAccessById(post.connectedAccount, connectedAccounts);
          const linkedinActionDisabled = !accountAccess?.isUsable;
          return (
            <article key={post._id} className="mq-post-row">
              <Link href={`/posts/${post._id}/edit`} className="mq-post-row-title">{compactTitle(post)}</Link>
              <div className="mq-post-row-status"><span className={`mq-status mq-status-${status.toLowerCase()}`}><i />{status[0] + status.slice(1).toLowerCase()}</span><span className="mq-mono">{dateLabel}</span>{showKind ? <span className="mq-post-row-kind">{postKind(post)}</span> : null}</div>
              <div className="mq-post-row-actions">
                <div className="mq-post-row-icons">
                {status === "DRAFT" ? <Link href={`/posts/${post._id}/edit`} className="mq-icon-button" title="Edit post"><Pencil size={15} /></Link> : null}
                {status === "SCHEDULED" ? <button type="button" className="mq-icon-button" title={linkedinActionDisabled ? LINKEDIN_ACCESS_EXPIRED_MESSAGE : "Schedule post"} disabled={linkedinActionDisabled} onClick={() => { setSchedulePostId(post._id); setScheduleValue(localDateTimeValue(parseDate(post.scheduledAt) ?? getDefaultScheduleDate())); }}><CalendarClock size={15} /></button> : null}
                {status !== "PUBLISHED" ? <button type="button" className="mq-icon-button" title={linkedinActionDisabled ? LINKEDIN_ACCESS_EXPIRED_MESSAGE : "Publish now"} disabled={linkedinActionDisabled || actionId === post._id} onClick={() => void runAction(post._id, "publish")}><Send size={15} /></button> : null}
                <button type="button" className="mq-icon-button mq-icon-danger" title="Delete post" disabled={actionId === post._id} onClick={() => setDeletePostId(post._id)}><Trash2 size={15} /></button>
                </div>
                <PostRowMenu
                  status={status}
                  editHref={`/posts/${post._id}/edit`}
                  linkedinDisabled={linkedinActionDisabled}
                  linkedinDisabledReason={LINKEDIN_ACCESS_EXPIRED_MESSAGE}
                  busy={actionId === post._id}
                  onSchedule={() => { setSchedulePostId(post._id); setScheduleValue(localDateTimeValue(parseDate(post.scheduledAt) ?? getDefaultScheduleDate())); }}
                  onPublish={() => void runAction(post._id, "publish")}
                  onDelete={() => setDeletePostId(post._id)}
                />
              </div>
              {schedulePostId === post._id ? (
                <div className="mq-inline-schedule">
                  <SchedulePicker value={scheduleValue} onChange={setScheduleValue} disabled={actionId === post._id} label="Move to" />
                  <button type="button" className="mq-primary-button mq-button-small" onClick={() => void schedulePost()} disabled={!scheduleValue || actionId === post._id}>Save time</button>
                  <button type="button" className="mq-ghost-button" onClick={() => setSchedulePostId(null)}>Cancel</button>
                </div>
              ) : null}
            </article>
          );
        })}
        <div className="mq-list-footer"><span>Showing {visiblePosts.length} of {posts.length}</span><span className="mq-pagination"><button type="button" disabled><ChevronLeft size={14} /></button><b>1</b><button type="button" disabled><ChevronRight size={14} /></button></span></div>
      </div>
      <DeleteConfirmModal
        isOpen={Boolean(deletePostId)}
        isPublished={normalizeStatus(posts.find((post) => post._id === deletePostId)?.status) === "PUBLISHED"}
        isDeleting={actionId === deletePostId}
        onClose={() => { if (!actionId) setDeletePostId(null); }}
        onConfirm={() => { if (deletePostId) void runAction(deletePostId, "delete").then((deleted) => { if (deleted) setDeletePostId(null); }); }}
      />
    </RedesignShell>
  );
}
