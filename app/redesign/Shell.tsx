"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  CalendarDays,
  CreditCard,
  Bell,
  Home,
  LifeBuoy,
  PenLine,
  Settings,
  Sparkles,
} from "lucide-react";
import type { ConnectedAccount, UserProfile } from "../lib/types";
import MarquillLockup from "../../components/brand/MarquillLockup";
import FeedbackModal from "./FeedbackModal";
import ThemeToggle from "./ThemeToggle";
import { getInitials } from "./types";
import type { WorkspacePage } from "./types";

const navItems: Array<{ key: WorkspacePage; label: string; href: string; icon: ReactNode }> = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: <Home size={18} /> },
  { key: "posts", label: "Posts", href: "/posts", icon: <PenLine size={18} /> },
  { key: "calendar", label: "Calendar", href: "/calendar", icon: <CalendarDays size={18} /> },
  { key: "billing", label: "Billing", href: "/billing", icon: <CreditCard size={18} /> },
  { key: "settings", label: "Settings", href: "/settings", icon: <Settings size={18} /> },
];
const mobileNavItems = navItems.filter((item) => item.key !== "billing");

function AccountAvatar({ account, size = "md" }: { account?: ConnectedAccount; size?: "sm" | "md" }) {
  const initials = getInitials(
    account?.displayName ?? account?.profile?.localizedFirstName ?? "",
    account?.vanityName,
  );
  return account?.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={account.avatarUrl}
      alt=""
      className={`mq-avatar mq-avatar-${size}`}
    />
  ) : (
    <span className={`mq-avatar mq-avatar-${size}`}>{initials || "—"}</span>
  );
}

export default function RedesignShell({
  user,
  accounts,
  selectedAccountId,
  onSelectAccount,
  active,
  title,
  topbarExtra,
  children,
}: {
  user: UserProfile;
  accounts: ConnectedAccount[];
  selectedAccountId?: string;
  onSelectAccount?: (accountId: string) => void;
  active: WorkspacePage;
  title: string;
  topbarExtra?: ReactNode;
  children: ReactNode;
}) {
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId);
  const initials = getInitials(user.name, user.email);

  return (
    <div className="mq-shell">
      <aside className="mq-sidebar">
        <Link href="/dashboard" className="mq-brand" aria-label="Marquill dashboard">
          <MarquillLockup size={29} theme="auto" className="mq-brand-lockup" />
        </Link>
        <Link href="/posts/new" className="mq-new-post">
          <Sparkles size={16} />
          <span>New post</span>
          <span className="mq-mono mq-new-post-hint">ask mark</span>
        </Link>

        <div className="mq-sidebar-section">
          <span className="mq-eyebrow">Workspace</span>
          <nav className="mq-sidebar-nav" aria-label="Workspace">
            {navItems.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className={`mq-sidebar-link ${item.key === active ? "is-active" : ""}`}
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>
        </div>

        <div className="mq-sidebar-section mq-connected">
          <div className="mq-sidebar-section-heading">
            <span className="mq-eyebrow">Connected</span>
            <span className="mq-plus">+</span>
          </div>
          {accounts.length ? (
            accounts.map((account) => (
              <button
                type="button"
                key={account.id}
                onClick={() => onSelectAccount?.(account.id)}
                className={`mq-account-row ${selectedAccountId === account.id ? "is-selected" : ""}`}
              >
                <AccountAvatar account={account} />
                <span className="mq-account-copy">
                  <strong>{account.displayName ?? "LinkedIn account"}</strong>
                  <small>{account.accountType === "ORGANIZATION" ? "Company page" : "Personal"}</small>
                </span>
                <span className="mq-provider-badge">in</span>
              </button>
            ))
          ) : (
            <Link href="/onboarding" className="mq-empty-account">
              Connect LinkedIn to publish
            </Link>
          )}
        </div>

        <button type="button" className="mq-sidebar-help" onClick={() => setIsFeedbackOpen(true)}>
          <LifeBuoy size={16} />
          <span>Help & feedback</span>
        </button>

        <div className="mq-sidebar-user">
          <span className="mq-avatar mq-avatar-md mq-avatar-accent">{initials}</span>
          <span className="mq-account-copy">
            <strong>{user.name}</strong>
            <small>{user.tier?.name ?? "Free"} plan</small>
          </span>
          <Link href="/billing" className="mq-upgrade-link">Upgrade</Link>
        </div>
      </aside>

      <div className="mq-main">
        <header className="mq-topbar">
          <div className="mq-topbar-title">{title}</div>
          <div className="mq-topbar-actions">
            {topbarExtra}
            <ThemeToggle compact />
            <button type="button" className="mq-feedback-topbar" onClick={() => setIsFeedbackOpen(true)} aria-label="Help and feedback"><LifeBuoy size={17} /></button>
            <span className="mq-notification" aria-label="Notifications">
              <span className="mq-live-dot" />
              <Bell className="mq-notification-icon" size={18} />
            </span>
            <span className="mq-avatar mq-avatar-md mq-avatar-accent">{initials}</span>
            <select
              className="mq-account-select"
              value={selectedAccountId ?? ""}
              onChange={(event) => onSelectAccount?.(event.target.value)}
              aria-label="Connected account"
            >
              {accounts.length ? (
                accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.displayName ?? "LinkedIn account"}
                  </option>
                ))
              ) : (
                <option value="">No account connected</option>
              )}
            </select>
          </div>
        </header>

        <main className="mq-content">{children}</main>
      </div>

      <nav className="mq-mobile-tabbar" aria-label="Mobile navigation">
        {mobileNavItems.slice(0, 2).map((item) => (
          <Link key={item.key} href={item.href} className={item.key === active ? "is-active" : ""}>
            {item.icon}
            <span>{item.key === "dashboard" ? "Home" : item.label}</span>
          </Link>
        ))}
        <Link href="/posts/new" className="mq-mobile-fab" aria-label="New post"><span>+</span></Link>
        {mobileNavItems.slice(2).map((item) => (
          <Link key={item.key} href={item.href} className={item.key === active ? "is-active" : ""}>
            {item.icon}
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>

      <span className="mq-selected-account-name" aria-hidden="true">{selectedAccount?.displayName}</span>
      <FeedbackModal key={isFeedbackOpen ? "open" : "closed"} isOpen={isFeedbackOpen} onClose={() => setIsFeedbackOpen(false)} />
    </div>
  );
}
