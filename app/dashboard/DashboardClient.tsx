"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  CalendarClock,
  LayoutDashboard,
  PenSquare,
  TrendingUp,
} from "lucide-react";
import Sidebar from "./Sidebar";
import { Card, Icon, ListItem, PillButton } from "./components";

const navItems = [
  { label: "Overview", active: true, icon: <LayoutDashboard className="h-4 w-4" /> },
  { label: "Posts", active: false, icon: <PenSquare className="h-4 w-4" /> },
  { label: "Calendar", active: false, icon: <CalendarClock className="h-4 w-4" /> },
  { label: "Analytics", active: false, icon: <TrendingUp className="h-4 w-4" /> },
];

type DashboardUser = {
  name: string;
  email: string;
  initials: string;
  avatarUrl?: string;
};

const linkedInAccounts = [
  { name: "Christopher Pam", initials: "CP" },
  { name: "Marquill Inc", initials: "MI" },
  { name: "Avery Johnson", initials: "AJ" },
];

const stats = {
  postsThisMonth: 12,
  postLimit: 30,
  usagePercent: 40,
};

const drafts = [
  {
    title: "How AI changes LinkedIn storytelling",
    updatedAt: "2 hours ago",
    status: "Draft",
  },
  {
    title: "3 prompts to refresh your content engine",
    updatedAt: "Yesterday",
    status: "Draft",
  },
  {
    title: "A simple YouTube research workflow",
    updatedAt: "Jan 28",
    status: "Draft",
  },
  {
    title: "Turning long videos into snackable posts",
    updatedAt: "Jan 24",
    status: "Draft",
  },
];

const scheduledPosts = [
  { date: "Feb 12", title: "Pricing lessons from creator tools" },
  { date: "Feb 18", title: "How to plan a 4-week content sprint" },
  { date: "Feb 26", title: "Metrics that prove your content works" },
];

function buildMonthGrid(baseDate: Date) {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  const cells: Array<{ day: number | null; isToday: boolean }> = [];
  const today = new Date();

  for (let i = 0; i < startOffset; i += 1) {
    cells.push({ day: null, isToday: false });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const isToday =
      today.getFullYear() === year &&
      today.getMonth() === month &&
      today.getDate() === day;
    cells.push({ day, isToday });
  }

  const totalCells = Math.ceil(cells.length / 7) * 7;
  while (cells.length < totalCells) {
    cells.push({ day: null, isToday: false });
  }

  return cells;
}

export default function DashboardPage({ user }: { user: DashboardUser }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const now = useMemo(() => new Date(), []);
  const monthLabel = now.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });
  const monthGrid = useMemo(() => buildMonthGrid(now), [now]);
  const usageRatio = Math.round((stats.postsThisMonth / stats.postLimit) * 100);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--color-background)]">
      <div className="pointer-events-none absolute -left-28 top-10 h-80 w-80 rounded-full bg-[var(--color-accent)]/25 blur-[140px]" />
      <div className="pointer-events-none absolute right-6 top-24 h-64 w-64 rounded-full bg-[var(--color-primary)]/20 blur-[120px]" />

      <div className="relative flex min-h-screen w-full flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 md:hidden">
          <Card className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-[var(--color-secondary)] text-sm font-semibold text-white">
                {user.initials}
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {user.name}
                </p>
                <p className="text-xs text-[var(--color-text-secondary)]">
                  {user.email}
                </p>
              </div>
            </div>
            <PillButton variant="secondary">Settings</PillButton>
          </Card>
          <nav className="flex gap-3 overflow-x-auto pb-1 text-sm">
            {navItems.map((item) => (
              <PillButton
                key={item.label}
                variant={item.active ? "primary" : "secondary"}
              >
                {item.label}
              </PillButton>
            ))}
          </nav>
        </header>

        <div
          className={`grid gap-6 ${
            sidebarCollapsed
              ? "md:grid-cols-[120px_1fr] lg:grid-cols-[140px_1fr]"
              : "md:grid-cols-[260px_1fr] lg:grid-cols-[280px_1fr]"
          }`}
        >
          <Sidebar
            user={{ ...user, role: "Product designer" }}
            items={navItems}
            accounts={linkedInAccounts}
            primaryAccountIndex={0}
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed((value) => !value)}
            showChrome
          />

          <main className="flex flex-col gap-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[var(--color-text-secondary)]">
                  Good afternoon, {user.name.split(" ")[0]}
                </p>
                <h1 className="mt-2 font-[var(--font-sora)] text-3xl font-semibold tracking-[-0.02em] text-[var(--color-text-primary)] sm:text-4xl">
                  Dashboard
                </h1>
              </div>
              <PillButton variant="secondary" icon={<CalendarClock className="h-4 w-4" />}>
                {monthLabel}
              </PillButton>
            </div>

            <section className="grid gap-4 lg:grid-cols-2">
              <Card className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                      Posts this month
                    </p>
                    <div className="mt-3 flex items-baseline gap-3">
                      <span className="text-3xl font-semibold text-[var(--color-text-primary)]">
                        {stats.postsThisMonth}
                      </span>
                      <span className="text-sm font-semibold text-[var(--color-text-secondary)]">
                        / {stats.postLimit}
                      </span>
                    </div>
                  </div>
                  <Icon>
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                      fill="currentColor"
                    >
                      <path d="M4.5 6.75A2.25 2.25 0 0 1 6.75 4.5h10.5A2.25 2.25 0 0 1 19.5 6.75v10.5A2.25 2.25 0 0 1 17.25 19.5H6.75A2.25 2.25 0 0 1 4.5 17.25V6.75Zm5.25.75a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-4.5Zm0 4.5a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-4.5Z" />
                    </svg>
                  </Icon>
                </div>
                <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
                  You are on track to hit your February goal.
                </p>
              </Card>

              <Card className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                      Usage
                    </p>
                    <div className="mt-3 flex items-baseline gap-3">
                      <span className="text-3xl font-semibold text-[var(--color-text-primary)]">
                        {usageRatio}%
                      </span>
                      <span className="text-sm font-semibold text-[var(--color-text-secondary)]">
                        this month
                      </span>
                    </div>
                  </div>
                  <Icon>
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                      fill="currentColor"
                    >
                      <path d="M3.75 12a8.25 8.25 0 0 1 14.25-5.7.75.75 0 0 1-1.06 1.06A6.75 6.75 0 1 0 18.75 12a.75.75 0 0 1 1.5 0 8.25 8.25 0 0 1-16.5 0Z" />
                      <path d="M12 6.75a.75.75 0 0 1 .75.75v4.19l2.47 2.47a.75.75 0 1 1-1.06 1.06l-2.69-2.69a.75.75 0 0 1-.22-.53V7.5a.75.75 0 0 1 .75-.75Z" />
                    </svg>
                  </Icon>
                </div>
                <div className="mt-4 h-2 w-full rounded-full bg-[var(--color-border)]">
                  <div
                    className="h-2 rounded-full bg-[var(--color-primary)]"
                    style={{ width: `${stats.usagePercent}%` }}
                  />
                </div>
              </Card>
            </section>

            <Card className="p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="font-[var(--font-sora)] text-xl font-semibold text-[var(--color-text-primary)]">
                    Quick actions
                  </h2>
                  <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                    Start a new idea or schedule content in seconds.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <PillButton icon={<PenSquare className="h-4 w-4" />}>
                    New post
                  </PillButton>
                  <PillButton
                    variant="secondary"
                    icon={<CalendarClock className="h-4 w-4" />}
                  >
                    Schedule
                  </PillButton>
                </div>
              </div>
            </Card>

            <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <Card className="p-6">
                <div className="flex items-center justify-between">
                  <h2 className="font-[var(--font-sora)] text-xl font-semibold text-[var(--color-text-primary)]">
                    Drafts
                  </h2>
                  <PillButton variant="ghost">View all</PillButton>
                </div>
                <div className="mt-6 flex flex-col gap-4">
                  {drafts.map((draft) => (
                    <ListItem
                      key={draft.title}
                      title={draft.title}
                      subtitle={`Updated ${draft.updatedAt}`}
                      badge={draft.status}
                      icon={<PenSquare className="h-4 w-4" />}
                    />
                  ))}
                </div>
              </Card>

              <Card className="p-6">
                <div className="flex items-center justify-between">
                  <h2 className="font-[var(--font-sora)] text-xl font-semibold text-[var(--color-text-primary)]">
                    Scheduled
                  </h2>
                  <PillButton variant="ghost" icon={<Activity className="h-4 w-4" />}>
                    Timeline
                  </PillButton>
                </div>

                <div className="mt-5 grid grid-cols-7 gap-2 text-center text-[11px] font-semibold text-[var(--color-text-secondary)]">
                  {["S", "M", "T", "W", "T", "F", "S"].map((label) => (
                    <div key={label}>{label}</div>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-7 gap-2">
                  {monthGrid.map((cell, index) => (
                    <div
                      key={`day-${index}`}
                      className={`flex h-9 items-center justify-center rounded-2xl text-xs font-semibold transition ${
                        cell.day === null
                          ? "text-transparent"
                          : cell.isToday
                          ? "bg-[var(--color-secondary)] text-white shadow-[0_12px_30px_-20px_rgba(28,27,39,0.45)]"
                          : "border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-white/70"
                      }`}
                    >
                      {cell.day ?? "0"}
                    </div>
                  ))}
                </div>

                <div className="mt-6 space-y-3">
                  {scheduledPosts.map((post) => (
                    <ListItem
                      key={post.title}
                      title={post.title}
                      subtitle={post.date}
                      badge="Scheduled"
                      icon={<CalendarClock className="h-4 w-4" />}
                    />
                  ))}
                </div>
              </Card>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}
