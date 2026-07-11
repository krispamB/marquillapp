"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Clock3, Plus } from "lucide-react";
import RedesignShell from "./Shell";
import { API_BASE, jsonRequest, readApi } from "./api";
import { formatScheduledDate, getPostTitle, normalizeStatus, parseDate, toYearMonth } from "./types";
import type { ConnectedAccount, DashboardPost, DashboardPostsResponse, UserProfile } from "../lib/types";

function monthCells(date: Date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const cell = new Date(start);
    cell.setDate(start.getDate() + index);
    return { date: cell, inMonth: cell.getMonth() === date.getMonth() };
  });
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dotClass(status?: string) {
  const normalized = normalizeStatus(status).toLowerCase();
  return `mq-calendar-dot-${normalized}`;
}

export default function CalendarRedesignClient({
  user,
  connectedAccounts,
  primaryAccountId,
}: {
  user: UserProfile;
  connectedAccounts: ConnectedAccount[];
  primaryAccountId?: string;
}) {
  const [selectedAccountId, setSelectedAccountId] = useState(primaryAccountId ?? connectedAccounts[0]?.id);
  const [cursor, setCursor] = useState(() => new Date());
  const [view, setView] = useState<"month" | "week">("month");
  const [posts, setPosts] = useState<DashboardPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadPosts = useCallback(async () => {
    if (!selectedAccountId) {
      setPosts([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const response = await readApi<DashboardPostsResponse>(`${API_BASE}/posts?accountConnected=${encodeURIComponent(selectedAccountId)}&month=${toYearMonth(cursor)}`);
      setPosts(Array.isArray(response?.data) ? response.data : []);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load calendar posts.");
    } finally {
      setIsLoading(false);
    }
  }, [cursor, selectedAccountId]);

  useEffect(() => { void loadPosts(); }, [loadPosts]);

  const cells = useMemo(() => monthCells(cursor), [cursor]);
  const postsByDay = useMemo(() => {
    const grouped = new Map<string, DashboardPost[]>();
    for (const post of posts) {
      const date = parseDate(post.scheduledAt ?? post.updatedAt ?? post.createdAt);
      if (!date) continue;
      const key = dayKey(date);
      grouped.set(key, [...(grouped.get(key) ?? []), post]);
    }
    return grouped;
  }, [posts]);
  const upcoming = useMemo(() => posts.filter((post) => normalizeStatus(post.status) === "SCHEDULED").sort((a, b) => (parseDate(a.scheduledAt)?.getTime() ?? 0) - (parseDate(b.scheduledAt)?.getTime() ?? 0)), [posts]);

  function shiftMonth(amount: number) {
    setCursor((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  }

  async function movePost(post: DashboardPost, date: Date) {
    if (!post._id) return;
    const current = parseDate(post.scheduledAt);
    const scheduledTime = new Date(date.getFullYear(), date.getMonth(), date.getDate(), current?.getHours() ?? 9, current?.getMinutes() ?? 0);
    try {
      await readApi(`${API_BASE}/posts/${post._id}/schedule`, jsonRequest({ scheduledTime: scheduledTime.toISOString() }, { method: "POST" }));
      setMessage(`Moved “${getPostTitle(post.content)}” to ${scheduledTime.toLocaleDateString(undefined, { month: "short", day: "numeric" })}.`);
      await loadPosts();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to reschedule post.");
    }
  }

  return (
    <RedesignShell
      user={user}
      accounts={connectedAccounts}
      selectedAccountId={selectedAccountId}
      onSelectAccount={setSelectedAccountId}
      active="calendar"
      title="Calendar"
      topbarExtra={<div className="mq-calendar-top-controls"><button type="button" className="mq-icon-button" onClick={() => shiftMonth(-1)} aria-label="Previous month"><ChevronLeft size={15} /></button><strong>{cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</strong><button type="button" className="mq-icon-button" onClick={() => shiftMonth(1)} aria-label="Next month"><ChevronRight size={15} /></button></div>}
    >
      <div className="mq-page-heading mq-page-heading-compact"><div><span className="mq-eyebrow">Scheduling queue</span><h1>{cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h1><p>Drag a post to a new day or open it to edit the draft.</p></div><Link href="/posts/new" className="mq-primary-button"><Plus size={16} /> New post</Link></div>
      {error ? <div className="mq-alert mq-alert-error">{error}</div> : null}
      {message ? <div className="mq-alert mq-alert-success">{message}</div> : null}

      <div className="mq-calendar-toolbar"><div className="mq-calendar-legend"><span><i className="mq-calendar-dot-scheduled" /> Scheduled</span><span><i className="mq-calendar-dot-published" /> Published</span><span><i className="mq-calendar-dot-draft" /> Draft</span></div><div className="mq-segmented mq-segmented-small"><button type="button" className={view === "month" ? "is-active" : ""} onClick={() => setView("month")}>Month</button><button type="button" className={view === "week" ? "is-active" : ""} onClick={() => setView("week")}>Week</button></div></div>

      {view === "month" ? (
        <div className="mq-card mq-calendar-card">
          <div className="mq-calendar-weekdays">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div>
          <div className="mq-calendar-grid">
            {cells.map(({ date, inMonth }) => {
              const items = postsByDay.get(dayKey(date)) ?? [];
              const isToday = dayKey(date) === dayKey(new Date());
              return (
                <div key={dayKey(date)} className={`mq-calendar-cell ${inMonth ? "" : "is-muted"} ${isToday ? "is-today" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { const postId = event.dataTransfer.getData("text/plain"); const post = posts.find((item) => item._id === postId); if (post) void movePost(post, date); }}>
                  <span className="mq-calendar-day">{date.getDate()}</span>
                  <div className="mq-calendar-events">
                    {items.slice(0, 3).map((post) => <Link key={post._id} href={`/posts/${post._id}/edit`} draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", post._id)} className="mq-calendar-event"><i className={dotClass(post.status)} />{getPostTitle(post.content)}</Link>)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mq-card mq-agenda-card">
          <div className="mq-card-heading"><span className="mq-title">Upcoming agenda</span><span className="mq-mono">{upcoming.length} scheduled</span></div>
          {isLoading ? <p className="mq-empty">Loading agenda…</p> : null}
          {!isLoading && !upcoming.length ? <p className="mq-empty">No scheduled posts in this month.</p> : null}
          {upcoming.map((post) => <div key={post._id} className="mq-agenda-row" draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", post._id)}><span className="mq-agenda-dot"><i className={dotClass(post.status)} /></span><span className="mq-row-copy"><strong>{getPostTitle(post.content)}</strong><small><Clock3 size={13} /> {formatScheduledDate(post.scheduledAt)}</small></span><Link href={`/posts/${post._id}/edit`} className="mq-secondary-button mq-button-small">Edit</Link></div>)}
        </div>
      )}
    </RedesignShell>
  );
}
