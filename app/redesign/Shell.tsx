"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  Coins,
  CreditCard,
  Bell,
  Home,
  Info,
  Layers3,
  LifeBuoy,
  PenLine,
  Plus,
  RefreshCw,
  Settings,
} from "lucide-react";
import type {
  ConnectedAccount,
  PaymentUsageMetric,
  PaymentUsageResponse,
  SubscriptionTier,
  UserProfile,
} from "../lib/types";
import MarquillLockup from "../../components/brand/MarquillLockup";
import LinkedInIcon from "../../components/brand/LinkedInIcon";
import FeedbackModal from "./FeedbackModal";
import LinkedInConnectButton from "./LinkedInConnectButton";
import OrganizationConnectModal from "./OrganizationConnectModal";
import ThemeToggle from "./ThemeToggle";
import { getInitials } from "./types";
import type { WorkspacePage } from "./types";
import MarquillSelect from "../../components/ui/MarquillSelect";
import { API_BASE, readApi } from "./api";

const navItems: Array<{ key: WorkspacePage; label: string; href: string; icon: ReactNode }> = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: <Home size={18} /> },
  { key: "artifacts", label: "Artifacts", href: "/artifacts", icon: <Layers3 size={18} /> },
  { key: "posts", label: "Posts", href: "/posts", icon: <PenLine size={18} /> },
  { key: "calendar", label: "Calendar", href: "/calendar", icon: <CalendarDays size={18} /> },
  { key: "billing", label: "Billing", href: "/billing", icon: <CreditCard size={18} /> },
  { key: "settings", label: "Settings", href: "/settings", icon: <Settings size={18} /> },
];
const mobileNavItems = navItems.filter((item) =>
  ["dashboard", "artifacts", "posts", "settings"].includes(item.key),
);

export const WORKSPACE_SELECTOR_VALUE = "__marquill_workspace__";

type TopbarConfig = {
  back?: {
    href: string;
    label?: string;
  };
  subtitle?: string;
  credits?: {
    refreshKey?: string;
  };
  minimal?: boolean;
};

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
  topbar,
  showAccountSelector = true,
  includeWorkspaceOption = false,
  hideMobileNav = false,
  subscription,
  initialUsage,
  children,
}: {
  user: UserProfile;
  accounts: ConnectedAccount[];
  selectedAccountId?: string;
  onSelectAccount?: (accountId: string) => void;
  active: WorkspacePage;
  title: string;
  topbarExtra?: ReactNode;
  topbar?: TopbarConfig;
  showAccountSelector?: boolean;
  includeWorkspaceOption?: boolean;
  hideMobileNav?: boolean;
  subscription?: SubscriptionTier | null;
  initialUsage?: PaymentUsageResponse["data"] | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [isOrganizationModalOpen, setIsOrganizationModalOpen] = useState(false);
  const [isConnectedExpanded, setIsConnectedExpanded] = useState(false);
  const [fetchedCreditUsage, setFetchedCreditUsage] = useState<PaymentUsageMetric | null>(null);
  const creditRefreshKey = topbar?.credits?.refreshKey;
  const showTopbarCredits = Boolean(topbar?.credits);
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId);
  const initials = getInitials(user.name, user.email);
  const tier = subscription ?? user.tier;
  const tierName = tier?.name?.trim() || "Free";
  const isFreeTier = Boolean(
    tier && (
      tier.isDefault === true ||
      tier.name.trim().toLowerCase().replace(/\s+plan$/, "") === "free"
    ),
  );
  const hasPersonalAccount = accounts.some((account) => account.accountType !== "ORGANIZATION");
  const connectedOrganizationIds = useMemo(
    () => accounts.filter((account) => account.accountType === "ORGANIZATION").map((account) => account.id),
    [accounts],
  );
  const sharedExpiry = accessExpiryLabel(
    accounts.find((account) => account.accountType !== "ORGANIZATION" && account.accessTokenExpiresAt)?.accessTokenExpiresAt
      ?? accounts.find((account) => account.accessTokenExpiresAt)?.accessTokenExpiresAt,
  );

  useEffect(() => {
    if (initialUsage && creditRefreshKey === undefined) return;
    const controller = new AbortController();
    readApi<PaymentUsageResponse>(`${API_BASE}/payment/usage`, { signal: controller.signal })
      .then((response) => setFetchedCreditUsage(response?.data?.usage.credits ?? null))
      .catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) {
          setFetchedCreditUsage(null);
        }
      });
    return () => controller.abort();
  }, [creditRefreshKey, initialUsage]);

  const creditUsage = fetchedCreditUsage ?? initialUsage?.usage.credits;
  const creditLimit = creditUsage?.limit ?? 0;
  const creditsRemaining = creditUsage
    ? Math.max(0, creditUsage.remaining ?? creditLimit - creditUsage.used)
    : null;
  const creditPercent = creditLimit > 0 && creditsRemaining !== null
    ? Math.min(100, (creditsRemaining / creditLimit) * 100)
    : 0;
  const numberFormatter = new Intl.NumberFormat();

  return (
    <div className={`mq-shell${hideMobileNav ? " mq-shell-no-mobile-nav" : ""}`}>
      <aside className="mq-sidebar">
        <Link href="/dashboard" className="mq-brand" aria-label="Marquill dashboard">
          <MarquillLockup size={29} theme="auto" className="mq-brand-lockup" />
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
            <button
              type="button"
              className="mq-connected-toggle"
              aria-expanded={isConnectedExpanded}
              aria-controls="mq-connected-accounts"
              onClick={() => setIsConnectedExpanded((expanded) => !expanded)}
            >
              <span className="mq-eyebrow">Connected</span>
              <ChevronDown size={15} className={isConnectedExpanded ? "is-expanded" : ""} />
            </button>
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
          {isConnectedExpanded ? (
            <div id="mq-connected-accounts" className="mq-connected-accounts">
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
            </div>
          ) : null}
        </div>

        <button type="button" className="mq-sidebar-help" onClick={() => setIsFeedbackOpen(true)}>
          <LifeBuoy size={16} />
          <span>Help & feedback</span>
        </button>

        <div className="mq-sidebar-footer">
          <div className="mq-credit-card" aria-label="Monthly credits">
            <div className="mq-credit-heading">
              <span className="mq-credit-title"><Coins size={17} /> Credits</span>
              <span className="mq-credit-remaining">
                {creditsRemaining === null ? "—" : numberFormatter.format(creditsRemaining)} left
              </span>
            </div>
            <div className="mq-credit-progress" role="progressbar" aria-label="Credits remaining" aria-valuemin={0} aria-valuemax={creditLimit || undefined} aria-valuenow={creditsRemaining ?? undefined}>
              <span style={{ width: `${creditPercent}%` }} />
            </div>
            <div className="mq-credit-meta">
              <span>{creditLimit > 0 ? `of ${numberFormatter.format(creditLimit)} / mo` : "Monthly allowance"}</span>
              <Link href="/billing">Buy more</Link>
            </div>
          </div>

          <div className="mq-sidebar-user">
            <span className="mq-avatar mq-avatar-md mq-avatar-accent">{initials}</span>
            <span className="mq-account-copy">
              <strong>{user.name}</strong>
              <small>{tierName} plan</small>
            </span>
            {isFreeTier ? <Link href="/billing" className="mq-upgrade-link">Upgrade</Link> : null}
          </div>
        </div>
      </aside>

      <div className="mq-main">
        <header className={`mq-topbar${showTopbarCredits ? " mq-topbar-with-credits" : ""}${topbar?.minimal ? " mq-topbar-minimal" : ""}`}>
          <div className="mq-topbar-leading">
            {topbar?.back ? (
              <Link href={topbar.back.href} className="mq-topbar-back" aria-label={topbar.back.label ?? "Back"}>
                <ArrowLeft size={18} />
              </Link>
            ) : null}
            <div className="mq-topbar-copy">
              <div className="mq-topbar-title">{title}</div>
              {topbar?.subtitle ? <div className="mq-topbar-subtitle">{topbar.subtitle}</div> : null}
            </div>
          </div>
          <div className="mq-topbar-actions">
            {topbarExtra}
            {showTopbarCredits ? (
              <Link href="/billing" className="mq-topbar-credits" aria-label="View monthly credit usage">
                <Coins size={16} />
                <strong>{creditsRemaining === null ? "—" : numberFormatter.format(creditsRemaining)}</strong>
                <span>credits</span>
              </Link>
            ) : null}
            <ThemeToggle compact />
            <button type="button" className="mq-feedback-topbar" onClick={() => setIsFeedbackOpen(true)} aria-label="Help and feedback"><LifeBuoy size={17} /></button>
            <span className="mq-notification" aria-label="Notifications">
              <span className="mq-live-dot" />
              <Bell className="mq-notification-icon" size={18} />
            </span>
            <span className="mq-avatar mq-avatar-md mq-avatar-accent">{initials}</span>
            {showAccountSelector ? (
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
            ) : null}
          </div>
        </header>

        <main className="mq-content">{children}</main>
      </div>

      {!hideMobileNav ? <nav className="mq-mobile-tabbar" aria-label="Mobile navigation">
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
      </nav> : null}

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
