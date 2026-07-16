"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  CreditCard,
  Bell,
  Home,
  Info,
  LifeBuoy,
  PenLine,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
} from "lucide-react";
import type { ConnectedAccount, UserProfile } from "../lib/types";
import MarquillLockup from "../../components/brand/MarquillLockup";
import LinkedInIcon from "../../components/brand/LinkedInIcon";
import FeedbackModal from "./FeedbackModal";
import LinkedInConnectButton from "./LinkedInConnectButton";
import OrganizationConnectModal from "./OrganizationConnectModal";
import ThemeToggle from "./ThemeToggle";
import { getInitials } from "./types";
import type { WorkspacePage } from "./types";
import MarquillSelect from "../../components/ui/MarquillSelect";

const navItems: Array<{ key: WorkspacePage; label: string; href: string; icon: ReactNode }> = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: <Home size={18} /> },
  { key: "posts", label: "Posts", href: "/posts", icon: <PenLine size={18} /> },
  { key: "calendar", label: "Calendar", href: "/calendar", icon: <CalendarDays size={18} /> },
  { key: "billing", label: "Billing", href: "/billing", icon: <CreditCard size={18} /> },
  { key: "settings", label: "Settings", href: "/settings", icon: <Settings size={18} /> },
];
const mobileNavItems = navItems.filter((item) => item.key !== "billing");

export const WORKSPACE_SELECTOR_VALUE = "__marquill_workspace__";

function AccountAvatar({ account, size = "md" }: { account?: ConnectedAccount; size?: "sm" | "md" }) {
  const initials = getInitials(
    account?.displayName ?? account?.profile?.localizedFirstName ?? "",
    account?.vanityName,
  );
  return (
    <span className="mq-account-avatar-wrap">
      {account?.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={account.avatarUrl} alt="" className={`mq-avatar mq-avatar-${size}`} />
      ) : (
        <span className={`mq-avatar mq-avatar-${size}`}>{initials || "—"}</span>
      )}
      {account ? <span className="mq-avatar-provider"><LinkedInIcon size={size === "sm" ? 11 : 14} /></span> : null}
    </span>
  );
}

function accessExpiryLabel(expiresAt?: string) {
  if (!expiresAt) return null;
  const timestamp = new Date(expiresAt).getTime();
  if (Number.isNaN(timestamp)) return null;
  const days = Math.ceil((timestamp - Date.now()) / 86_400_000);
  if (days <= 0) return { text: "Access expired", isUrgent: true };
  return { text: `Access ends in ${days} day${days === 1 ? "" : "s"}`, isUrgent: days <= 7 };
}

export default function RedesignShell({
  user,
  accounts,
  selectedAccountId,
  onSelectAccount,
  active,
  title,
  topbarExtra,
  includeWorkspaceOption = false,
  children,
}: {
  user: UserProfile;
  accounts: ConnectedAccount[];
  selectedAccountId?: string;
  onSelectAccount?: (accountId: string) => void;
  active: WorkspacePage;
  title: string;
  topbarExtra?: ReactNode;
  includeWorkspaceOption?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [isOrganizationModalOpen, setIsOrganizationModalOpen] = useState(false);
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId);
  const initials = getInitials(user.name, user.email);
  const hasPersonalAccount = accounts.some((account) => account.accountType !== "ORGANIZATION");
  const connectedOrganizationIds = useMemo(
    () => accounts.filter((account) => account.accountType === "ORGANIZATION").map((account) => account.id),
    [accounts],
  );
  const sharedExpiry = accessExpiryLabel(
    accounts.find((account) => account.accountType !== "ORGANIZATION" && account.accessTokenExpiresAt)?.accessTokenExpiresAt
      ?? accounts.find((account) => account.accessTokenExpiresAt)?.accessTokenExpiresAt,
  );

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
            <div className="mq-account-actions">
              <button type="button" className="mq-account-action" title="Connected LinkedIn accounts and organization pages" aria-label="Information about connected accounts"><Info size={16} /></button>
              <LinkedInConnectButton className="mq-account-action" title="Reconnect LinkedIn account" aria-label="Reconnect LinkedIn account">
                <RefreshCw size={16} />
              </LinkedInConnectButton>
              <button
                type="button"
                className="mq-account-action"
                title={hasPersonalAccount ? "Connect an organization page" : "Connect a personal LinkedIn account first"}
                aria-label="Connect an organization page"
                disabled={!hasPersonalAccount}
                onClick={() => setIsOrganizationModalOpen(true)}
              >
                <Plus size={16} />
              </button>
            </div>
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
                  <small className={sharedExpiry?.isUrgent ? "is-urgent" : ""}>{sharedExpiry?.text ?? (account.accountType === "ORGANIZATION" ? "Company page" : "Personal")}</small>
                </span>
              </button>
            ))
          ) : (
            <LinkedInConnectButton className="mq-empty-account">
              Connect LinkedIn to publish
            </LinkedInConnectButton>
          )}
          <Link href="/settings" className="mq-manage-accounts">Manage accounts</Link>
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
            <MarquillSelect
              className="mq-account-select"
              value={selectedAccountId ?? ""}
              onChange={(value) => onSelectAccount?.(value)}
              ariaLabel={includeWorkspaceOption ? "Dashboard scope" : "Connected account"}
              options={[
                ...(includeWorkspaceOption
                  ? [{ value: WORKSPACE_SELECTOR_VALUE, label: "Workspace" }]
                  : []),
                ...accounts.map((account) => ({
                  value: account.id,
                  label: account.displayName ?? "LinkedIn account",
                  icon: <AccountAvatar account={account} size="sm" />,
                })),
                ...(!includeWorkspaceOption && !accounts.length
                  ? [{ value: "", label: "No account connected", disabled: true }]
                  : []),
              ]}
            />
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
      <OrganizationConnectModal
        isOpen={isOrganizationModalOpen}
        connectedOrganizationIds={connectedOrganizationIds}
        onClose={() => setIsOrganizationModalOpen(false)}
        onConnected={() => router.refresh()}
      />
    </div>
  );
}
