import { useState, useRef, useEffect } from "react";
import type { MouseEventHandler, ReactNode } from "react";
import Link from "next/link";
import { CalendarClock, CheckCheck, PenLine, Plug, ChevronDown, Check, X, AlertTriangle, Building2, Trash2 } from "lucide-react";
import type {
  ConnectedAccount,
  ConnectedAccountProvider,
  PostStatus,
  UserProfile,
  LinkedInOrg,
  ListOrgsResponse,
  ConnectOrgsResponse,
  DisconnectAccountResponse,
} from "../lib/types";

export function Icon({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`grid h-9 w-9 place-items-center rounded-full bg-white/80 text-[var(--color-secondary)] shadow-[0_12px_24px_-18px_rgba(15,23,42,0.5)] ${className}`}
    >
      {children}
    </span>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-3xl border border-[var(--color-border)] bg-white/75 p-5 shadow-[0_30px_70px_-60px_rgba(15,23,42,0.4)] backdrop-blur-md ${className}`}
    >
      {children}
    </div>
  );
}

export function PillButton({
  children,
  variant = "primary",
  icon,
  onClick,
  ariaLabel,
  ariaExpanded,
  ariaControls,
  type = "button",
  disabled = false,
  className = "",
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  icon?: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  ariaLabel?: string;
  ariaExpanded?: boolean;
  ariaControls?: string;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  className?: string;
}) {
  const base =
    "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60";
  const styles: Record<typeof variant, string> = {
    primary:
      "bg-[var(--color-secondary)] text-white shadow-[0_18px_40px_-26px_rgba(28,27,39,0.55)] hover:-translate-y-0.5",
    secondary:
      "border border-[var(--color-border)] bg-white/85 text-[var(--color-text-secondary)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]",
    ghost:
      "border border-transparent bg-transparent text-[var(--color-text-secondary)] hover:bg-white/70",
  };

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      className={`${base} ${styles[variant]} ${className}`}
    >
      {icon ? <span className="text-base">{icon}</span> : null}
      {children}
    </button>
  );
}

export function ConnectAccountCta({
  isConnectMenuOpen,
  onToggleConnectMenu,
  onConnectLinkedIn,
  onConnectLinkedInOrg,
  isConnectingLinkedIn = false,
  isConnectingOrg = false,
  hasPersonalAccount = false,
  menuId = "connect-account-menu-cta",
}: {
  isConnectMenuOpen: boolean;
  onToggleConnectMenu: () => void;
  onConnectLinkedIn: () => void;
  onConnectLinkedInOrg?: () => void;
  isConnectingLinkedIn?: boolean;
  isConnectingOrg?: boolean;
  hasPersonalAccount?: boolean;
  menuId?: string;
}) {
  return (
    <Card className="relative overflow-visible border-[var(--color-border)] bg-white/80 p-0">
      <div className="pointer-events-none absolute left-4 right-4 top-2 h-1.5 rounded-full bg-gradient-to-r from-[var(--color-primary)] via-[#8B6CFF] to-[var(--color-accent)]" />
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] text-white">
            <Plug className="h-4 w-4" />
          </span>
          <div>
            <p className="text-base font-semibold text-[var(--color-text-primary)]">
              Connect your account
            </p>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              You are one step away from loading your dashboard data and publishing tools.
            </p>
          </div>
        </div>
        <div className="relative">
          <PillButton
            variant="primary"
            ariaLabel="Open connect account options"
            ariaExpanded={isConnectMenuOpen}
            ariaControls={menuId}
            onClick={onToggleConnectMenu}
            className="w-fit"
          >
            Connect account
          </PillButton>
          <ConnectProviderMenu
            menuId={menuId}
            isOpen={isConnectMenuOpen}
            isConnectingLinkedIn={isConnectingLinkedIn}
            isConnectingOrg={isConnectingOrg}
            hasPersonalAccount={hasPersonalAccount}
            onConnectLinkedIn={onConnectLinkedIn}
            onConnectLinkedInOrg={onConnectLinkedInOrg}
          />
        </div>
      </div>
    </Card>
  );
}

export function ConnectProviderMenu({
  menuId,
  isOpen,
  isConnectingLinkedIn = false,
  isConnectingOrg = false,
  hasPersonalAccount = false,
  onConnectLinkedIn,
  onConnectLinkedInOrg,
  align = "right",
}: {
  menuId: string;
  isOpen: boolean;
  isConnectingLinkedIn?: boolean;
  isConnectingOrg?: boolean;
  hasPersonalAccount?: boolean;
  onConnectLinkedIn: () => void;
  onConnectLinkedInOrg?: () => void;
  align?: "left" | "right";
}) {
  return (
    <div
      id={menuId}
      role="menu"
      aria-hidden={!isOpen}
      className={`pointer-events-none absolute top-12 z-40 w-56 transition-all duration-200 ${
        align === "right" ? "right-0" : "left-0"
      } ${isOpen ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`}
    >
      <div className="pointer-events-auto overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white/95 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.45)] backdrop-blur-md">
        {/* LinkedIn Personal */}
        <button
          type="button"
          role="menuitem"
          onClick={onConnectLinkedIn}
          disabled={isConnectingLinkedIn}
          className="flex w-full items-center gap-3 px-4 py-3 text-sm font-semibold text-[var(--color-text-primary)] transition hover:bg-[var(--color-primary)]/6 disabled:cursor-not-allowed disabled:opacity-60"
          aria-label="Connect LinkedIn personal account"
        >
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0A66C2]/10">
            <img src="/LinkedIn_Icon_1.webp" alt="LinkedIn" className="h-5 w-5 object-contain" />
          </span>
          <span className="flex flex-col items-start min-w-0">
            <span>{isConnectingLinkedIn ? "Connecting..." : "LinkedIn"}</span>
            <span className="text-[11px] font-normal text-[var(--color-text-secondary)]">Personal account</span>
          </span>
        </button>

        <div className="mx-3 h-px bg-[var(--color-border)]" />

        {/* LinkedIn Organization Page */}
        <div className="relative">
          <button
            type="button"
            role="menuitem"
            onClick={onConnectLinkedInOrg}
            disabled={isConnectingOrg || !hasPersonalAccount || !onConnectLinkedInOrg}
            className="flex w-full items-center gap-3 px-4 py-3 text-sm font-semibold text-[var(--color-text-primary)] transition hover:bg-[var(--color-primary)]/6 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Connect LinkedIn organization page"
          >
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)]/15">
              <img src="/LinkedIn_Icon_1.webp" alt="LinkedIn" className="h-5 w-5 object-contain" />
            </span>
            <span className="flex flex-col items-start min-w-0">
              <span>{isConnectingOrg ? "Loading pages..." : "LinkedIn Page"}</span>
              <span className="text-[11px] font-normal text-[var(--color-text-secondary)]">
                {!hasPersonalAccount ? "Connect a personal account first" : "Organization / Company"}
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function NavItem({
  label,
  active,
  icon,
  href,
  disabled = false,
  collapsed = false,
}: {
  label: string;
  active?: boolean;
  icon: ReactNode;
  href?: string;
  disabled?: boolean;
  collapsed?: boolean;
}) {
  const className = `flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition ${
    disabled
      ? "cursor-not-allowed opacity-45"
      : active
      ? "bg-[var(--color-primary)] text-white shadow-[0_18px_35px_-26px_rgba(91,92,246,0.45)]"
      : "text-[var(--color-text-secondary)] hover:bg-white/70"
  }`;

  const content = (
    <>
      <span className="grid h-9 w-9 place-items-center rounded-full bg-white/80 text-[var(--color-secondary)]">
        {icon}
      </span>
      {collapsed ? null : <span>{label}</span>}
    </>
  );

  if (href && !disabled) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" disabled={disabled} aria-disabled={disabled} className={className}>
      {content}
    </button>
  );
}

export function ListItem({
  title,
  subtitle,
  status,
  badge,
  onClick,
  ariaLabel,
}: {
  title: string;
  subtitle: string;
  status?: PostStatus;
  badge?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  ariaLabel?: string;
}) {
  const containerClassName = `flex w-full flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--color-border)] bg-white/85 px-4 py-3 text-left transition ${
    onClick
      ? "cursor-pointer hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/30"
      : "hover:-translate-y-0.5"
  }`;
  const content = (
    <>
      <div className="min-w-0 flex-1">
        <p className="truncate whitespace-nowrap text-sm font-semibold text-[var(--color-text-primary)]">
          {title}
        </p>
        <p className="truncate whitespace-nowrap text-xs text-[var(--color-text-secondary)]">
          {subtitle}
        </p>
      </div>
      <div className="shrink-0">
        {status ? <StatusTag status={status} /> : null}
        {!status && badge ? (
          <span className="w-fit rounded-full bg-[var(--color-accent)]/20 px-3 py-1 text-xs font-semibold text-[var(--color-primary)]">
            {badge}
          </span>
        ) : null}
      </div>
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-label={ariaLabel} className={containerClassName}>
        {content}
      </button>
    );
  }

  return <div className={containerClassName}>{content}</div>;
}

const statusVisuals: Record<
  PostStatus,
  { label: string; bg: string; fg: string; icon: ReactNode }
> = {
  DRAFT: {
    label: "Draft",
    bg: "#E8EAFE",
    fg: "#4E5CF0",
    icon: <PenLine className="h-3.5 w-3.5" />,
  },
  SCHEDULED: {
    label: "Scheduled",
    bg: "#F6F1DE",
    fg: "#7A5A00",
    icon: <CalendarClock className="h-3.5 w-3.5" />,
  },
  PUBLISHED: {
    label: "Published",
    bg: "#E2F0E9",
    fg: "#1E7A52",
    icon: <CheckCheck className="h-3.5 w-3.5" />,
  },
};

export function StatusTag({
  status,
  size = "sm",
}: {
  status: PostStatus;
  size?: "sm" | "md";
}) {
  const visual = statusVisuals[status];
  const sizing =
    size === "md"
      ? "gap-1.5 px-3.5 py-1.5 text-sm"
      : "gap-1.5 px-3 py-1 text-xs";

  return (
    <span
      className={`inline-flex w-fit items-center rounded-full font-semibold ${sizing}`}
      style={{ backgroundColor: visual.bg, color: visual.fg }}
      aria-label={`Status: ${visual.label}`}
    >
      {visual.icon}
      {visual.label}
    </span>
  );
}

export function UserAvatar({
  initials,
  avatarUrl,
  sizeClass = "h-10 w-10",
  textClass = "text-sm",
}: {
  initials: string;
  avatarUrl?: UserProfile["avatar"];
  sizeClass?: string;
  textClass?: string;
}) {
  return (
    <div className="rounded-full bg-gradient-to-br from-[#7C3AED] via-[#A855F7] to-[#EC4899] p-[2px]">
      <div
        className={`grid ${sizeClass} place-items-center overflow-hidden rounded-full bg-[var(--color-secondary)] font-semibold text-white ${textClass}`}
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <span>{initials}</span>
        )}
      </div>
    </div>
  );
}

function getProviderLabel(provider: ConnectedAccountProvider) {
  switch (provider) {
    case "LINKEDIN":
      return "LinkedIn";
    default:
      return "Connected";
  }
}

function getProviderInitials(provider: ConnectedAccountProvider) {
  const label = getProviderLabel(provider);
  return label.slice(0, 2).toUpperCase();
}

function getAccountLabel(account?: ConnectedAccount) {
  if (!account) {
    return "No connected account";
  }
  return account.displayName || getProviderLabel(account.provider);
}

export function MobileAccountChip({
  account,
  onOpenSwitcher,
  disabled = false,
}: {
  account?: ConnectedAccount;
  onOpenSwitcher: () => void;
  disabled?: boolean;
}) {
  const providerLabel = account ? getProviderLabel(account.provider) : "Account";
  const providerInitials = account ? getProviderInitials(account.provider) : "AC";

  return (
    <button
      type="button"
      onClick={onOpenSwitcher}
      disabled={disabled}
      className="inline-flex h-11 w-full items-center justify-between gap-3 rounded-full border border-[var(--color-border)] bg-white/90 px-4 text-sm font-semibold text-[var(--color-text-primary)] shadow-[0_16px_36px_-30px_rgba(15,23,42,0.6)] transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
      aria-label="Open connected account selector"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)]/12 text-[11px] font-semibold text-[var(--color-primary)]">
          {providerInitials}
        </span>
        <span className="min-w-0 truncate">{getAccountLabel(account)}</span>
      </span>
      <span className="shrink-0 text-xs text-[var(--color-text-secondary)]">
        {account?.vanityName ? `@${account.vanityName}` : providerLabel}
      </span>
    </button>
  );
}

export function MobileAccountSwitcherSheet({
  isOpen,
  accounts,
  selectedAccountId,
  onClose,
  onSelectAccount,
}: {
  isOpen: boolean;
  accounts: ConnectedAccount[];
  selectedAccountId?: string;
  onClose: () => void;
  onSelectAccount: (accountId: string) => void;
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 bg-black/35"
        onClick={onClose}
        aria-label="Close account selector"
      />
      <div className="absolute inset-x-0 bottom-0 rounded-t-3xl border border-[var(--color-border)] bg-white p-4 pb-6 shadow-[0_-24px_60px_-40px_rgba(15,23,42,0.6)]">
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[var(--color-border)]" />
        <h3 className="text-base font-semibold text-[var(--color-text-primary)]">
          Connected accounts
        </h3>
        <div className="mt-4 flex max-h-[45vh] flex-col gap-2 overflow-y-auto">
          {accounts.length === 0 ? (
            <p className="rounded-2xl border border-[var(--color-border)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
              No connected accounts yet.
            </p>
          ) : null}
          {accounts.map((account) => {
            const isSelected = account.id === selectedAccountId;
            return (
              <button
                key={account.id}
                type="button"
                onClick={() => {
                  onSelectAccount(account.id);
                  onClose();
                }}
                className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                  isSelected
                    ? "border-[var(--color-primary)] bg-[var(--color-primary)]/8 text-[var(--color-text-primary)]"
                    : "border-[var(--color-border)] bg-white text-[var(--color-text-secondary)]"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-[var(--color-text-primary)]">
                    {getAccountLabel(account)}
                  </span>
                  <span className="block text-xs">
                    {account.vanityName ? `@${account.vanityName}` : getProviderLabel(account.provider)}
                  </span>
                </span>
                {isSelected ? (
                  <span className="rounded-full bg-[var(--color-primary)] px-2 py-0.5 text-[10px] font-semibold text-white">
                    Active
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function MobileBottomNav({
  items,
}: {
  items: Array<{
    label: string;
    icon: ReactNode;
    href?: string;
    active?: boolean;
    disabled?: boolean;
  }>;
}) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--color-border)] bg-white/90 px-2 py-2 backdrop-blur-md md:hidden"
      aria-label="Mobile dashboard navigation"
    >
      <ul className="grid grid-cols-4 gap-1">
        {items.map((item) => {
          const itemClass = `flex h-12 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-semibold transition ${
            item.disabled
              ? "opacity-45"
              : item.active
              ? "bg-[var(--color-secondary)] text-white"
              : "text-[var(--color-text-secondary)] hover:bg-[var(--color-primary)]/8"
          }`;
          const content = (
            <>
              <span className="text-sm">{item.icon}</span>
              <span className="leading-none">{item.label}</span>
            </>
          );

          return (
            <li key={item.label}>
              {item.href && !item.disabled ? (
                <Link href={item.href} className={itemClass}>
                  {content}
                </Link>
              ) : (
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  className={`${itemClass} w-full`}
                >
                  {content}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ─── OrgAvatar ───────────────────────────────────────────────────────────────

export function OrgAvatar({
  name,
  logoUrl,
  sizeClass = "h-10 w-10",
  textClass = "text-sm",
}: {
  name: string;
  logoUrl?: string | null;
  sizeClass?: string;
  textClass?: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div
      className={`grid ${sizeClass} place-items-center overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] ${textClass} font-semibold`}
    >
      {logoUrl ? (
        <img src={logoUrl} alt="" className="h-full w-full object-contain p-1" />
      ) : (
        <span className="text-[var(--color-primary)]">{initials || "?"}</span>
      )}
    </div>
  );
}

// ─── CompanyBadge ─────────────────────────────────────────────────────────────

export function CompanyBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-[var(--color-accent)]/20 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--color-primary)]">
      Company
    </span>
  );
}

// ─── ConnectOrgModal ─────────────────────────────────────────────────────────

type ConnectOrgPhase =
  | "loading_orgs"
  | "error_orgs"
  | "no_orgs"
  | "all_connected"
  | "select"
  | "connecting"
  | "success"
  | "error_connect";

export function ConnectOrgModal({
  isOpen,
  onClose,
  onSuccess,
  alreadyConnectedOrgIds,
  apiBase,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  alreadyConnectedOrgIds: string[];
  apiBase: string;
}) {
  const [phase, setPhase] = useState<ConnectOrgPhase>("loading_orgs");
  const [orgs, setOrgs] = useState<LinkedInOrg[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [errorMsg, setErrorMsg] = useState("");

  const fetchOrgs = async () => {
    setPhase("loading_orgs");
    setErrorMsg("");
    try {
      const res = await fetch(`${apiBase}/auth/linkedin/orgs`, {
        credentials: "include",
      });
      const json: ListOrgsResponse = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message ?? "Failed to load organization pages.");
      const list = json.data ?? [];
      setOrgs(list);
      if (list.length === 0) { setPhase("no_orgs"); return; }
      if (list.every((o) => alreadyConnectedOrgIds.includes(o.id))) {
        setPhase("all_connected"); return;
      }
      setPhase("select");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to load pages.");
      setPhase("error_orgs");
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setSelectedIds(new Set());
    void fetchOrgs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // ESC key handler
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const toggleOrg = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleConnect = async () => {
    setPhase("connecting");
    setErrorMsg("");
    try {
      const res = await fetch(`${apiBase}/auth/linkedin/orgs`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationIds: [...selectedIds] }),
      });
      const json: ConnectOrgsResponse = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message ?? "Failed to connect organization pages.");
      setPhase("success");
      onSuccess();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to connect pages.");
      setPhase("error_connect");
    }
  };

  if (!isOpen) return null;

  const selectedCount = selectedIds.size;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal card */}
      <div className="relative z-10 w-full max-w-[520px] rounded-2xl bg-white p-8 shadow-[0_24px_60px_-15px_rgba(0,0,0,0.3)]">
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 flex flex-col items-center justify-center text-slate-300 hover:text-slate-500 transition-colors"
          aria-label="Close"
        >
          <X className="h-5 w-5 mb-0.5" strokeWidth={2} />
          <span className="text-[9px] font-bold tracking-wider opacity-80">ESC</span>
        </button>

        {/* ── loading_orgs ── */}
        {phase === "loading_orgs" && (
          <div className="flex flex-col items-center gap-4 py-10">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-[var(--color-border)] border-t-[var(--color-primary)]" />
            <p className="text-sm font-medium text-[var(--color-text-secondary)]">
              Loading your organization pages…
            </p>
          </div>
        )}

        {/* ── error_orgs ── */}
        {phase === "error_orgs" && (
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <p className="text-sm font-semibold text-rose-500">{errorMsg}</p>
            <PillButton variant="secondary" onClick={() => void fetchOrgs()}>
              Retry
            </PillButton>
          </div>
        )}

        {/* ── no_orgs ── */}
        {phase === "no_orgs" && (
          <div className="flex flex-col items-center gap-4 py-8 text-center px-4">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-[var(--color-background)]">
              <Building2 className="h-5 w-5 text-[var(--color-text-secondary)]" />
            </div>
            <p className="text-base font-semibold text-[var(--color-text-primary)]">No pages found</p>
            <p className="text-sm text-[var(--color-text-secondary)] max-w-[260px] leading-relaxed">
              Your LinkedIn account doesn&apos;t manage any Company Pages, or none were returned by LinkedIn.
            </p>
            <PillButton variant="secondary" onClick={onClose}>Close</PillButton>
          </div>
        )}

        {/* ── all_connected ── */}
        {phase === "all_connected" && (
          <div className="flex flex-col items-center gap-4 py-8 text-center px-4">
            <p className="text-base font-semibold text-[var(--color-text-primary)]">All pages connected</p>
            <p className="text-sm text-[var(--color-text-secondary)] max-w-[260px] leading-relaxed">
              All organization pages managed by your LinkedIn account are already connected.
            </p>
            <PillButton variant="secondary" onClick={onClose}>Close</PillButton>
          </div>
        )}

        {/* ── select ── */}
        {phase === "select" && (
          <>
            <h2 className="text-xl font-bold text-[var(--color-text-primary)] tracking-tight text-center mt-2 mb-2">
              Connect an Organization Page
            </h2>
            <p className="text-center text-sm text-[var(--color-text-secondary)] mb-6">
              Select one or more LinkedIn Company Pages you manage.
            </p>

            <ul className="flex flex-col gap-2 max-h-[320px] overflow-y-auto pr-1">
              {orgs.map((org) => {
                const isAlreadyConnected = alreadyConnectedOrgIds.includes(org.id);
                const isSelected = selectedIds.has(org.id);
                return (
                  <li key={org.id}>
                    <button
                      type="button"
                      disabled={isAlreadyConnected}
                      onClick={() => toggleOrg(org.id)}
                      className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                        isAlreadyConnected
                          ? "border-[var(--color-border)] bg-white/60 opacity-60 cursor-not-allowed"
                          : isSelected
                          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/8"
                          : "border-[var(--color-border)] bg-white/80 hover:border-[var(--color-primary)]/45"
                      }`}
                    >
                      <OrgAvatar
                        name={org.name}
                        logoUrl={org.logoUrl}
                        sizeClass="h-10 w-10 shrink-0"
                        textClass="text-xs"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                          {org.name}
                        </p>
                        <p className="text-[11px] text-[var(--color-text-secondary)] capitalize lowercase">
                          {org.role.charAt(0) + org.role.slice(1).toLowerCase()}
                        </p>
                      </div>
                      {isAlreadyConnected ? (
                        <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-600">
                          Connected
                        </span>
                      ) : isSelected ? (
                        <span className="shrink-0 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-primary)]">
                          <Check className="h-3 w-3 text-white" strokeWidth={3} />
                        </span>
                      ) : (
                        <span className="shrink-0 h-5 w-5 rounded-full border-2 border-[var(--color-border)]" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="mt-6 flex justify-center">
              <PillButton
                variant="primary"
                disabled={selectedCount === 0}
                onClick={() => void handleConnect()}
              >
                Connect {selectedCount > 0 ? `${selectedCount} page${selectedCount > 1 ? "s" : ""}` : "pages"}
              </PillButton>
            </div>
          </>
        )}

        {/* ── connecting ── */}
        {phase === "connecting" && (
          <div className="flex flex-col items-center gap-4 py-10">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-[var(--color-border)] border-t-[var(--color-primary)]" />
            <p className="text-sm font-medium text-[var(--color-text-secondary)]">
              Connecting your pages…
            </p>
          </div>
        )}

        {/* ── success ── */}
        {phase === "success" && (
          <div className="flex flex-col items-center justify-center text-center py-6 px-4">
            <div className="mb-6 grid h-14 w-14 place-items-center rounded-full bg-white shadow-[0_8px_16px_-6px_rgba(0,0,0,0.1)]">
              <Check className="h-6 w-6 text-emerald-500" strokeWidth={3} />
            </div>
            <h2 className="mb-2 text-xl font-bold text-[var(--color-text-primary)]">
              {selectedCount === 1 ? "Page connected!" : "Pages connected!"}
            </h2>
            <p className="mb-8 text-sm text-[var(--color-text-secondary)] max-w-[260px] leading-relaxed">
              Your organization {selectedCount === 1 ? "page has" : "pages have"} been added to your account switcher.
            </p>
            <PillButton variant="primary" onClick={onClose}>Done</PillButton>
          </div>
        )}

        {/* ── error_connect ── */}
        {phase === "error_connect" && (
          <div className="flex flex-col items-center gap-4 py-8 text-center px-4">
            <p className="text-sm font-semibold text-rose-500">{errorMsg}</p>
            <div className="flex gap-3">
              <PillButton variant="secondary" onClick={onClose}>Cancel</PillButton>
              <PillButton variant="primary" onClick={() => void handleConnect()}>Try again</PillButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── DisconnectAccountModal ───────────────────────────────────────────────────

export function DisconnectAccountModal({
  isOpen,
  accountName,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  accountName: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [phase, setPhase] = useState<"confirm" | "disconnecting">("confirm");

  // Reset phase when modal reopens
  useEffect(() => {
    if (isOpen) setPhase("confirm");
  }, [isOpen]);

  // ESC key
  useEffect(() => {
    if (!isOpen || phase === "disconnecting") return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose, phase]);

  const handleConfirm = async () => {
    setPhase("disconnecting");
    await onConfirm();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={phase === "disconnecting" ? undefined : onClose}
      />
      <div className="relative z-10 w-full max-w-[420px] rounded-2xl bg-white p-8 shadow-[0_24px_60px_-15px_rgba(0,0,0,0.3)]">
        {phase === "confirm" && (
          <>
            <button
              type="button"
              onClick={onClose}
              className="absolute right-5 top-5 flex flex-col items-center justify-center text-slate-300 hover:text-slate-500 transition-colors"
              aria-label="Close"
            >
              <X className="h-5 w-5 mb-0.5" strokeWidth={2} />
              <span className="text-[9px] font-bold tracking-wider opacity-80">ESC</span>
            </button>
            <div className="flex flex-col gap-5 py-2">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-rose-50">
                  <AlertTriangle className="h-5 w-5 text-rose-500" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-[var(--color-text-primary)]">
                    Remove {accountName}?
                  </h2>
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    This will disconnect the account from Marquill.
                  </p>
                </div>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-sm font-semibold text-amber-700">Scheduled posts will be affected</p>
                <p className="mt-1 text-xs text-amber-600 leading-relaxed">
                  Any posts scheduled for this account will be cancelled when it is removed.
                </p>
              </div>
              <div className="flex gap-3 justify-end mt-2">
                <PillButton variant="secondary" onClick={onClose}>Cancel</PillButton>
                <PillButton
                  variant="primary"
                  onClick={() => void handleConfirm()}
                  className="bg-rose-500 shadow-[0_18px_40px_-26px_rgba(239,68,68,0.55)] hover:bg-rose-600"
                >
                  Remove account
                </PillButton>
              </div>
            </div>
          </>
        )}

        {phase === "disconnecting" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-[var(--color-border)] border-t-rose-500" />
            <p className="text-sm text-[var(--color-text-secondary)]">Removing account…</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Trash2 re-export for Sidebar use ────────────────────────────────────────
export { Trash2 };

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export function CustomSelect({
  value,
  onChange,
  options,
  placeholder = "Select...",
  icon,
  className = "",
  disabled = false,
  ariaLabel,
  dropdownPosition = "bottom",
  dropdownHeader,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  icon?: ReactNode;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
  dropdownPosition?: "top" | "bottom";
  dropdownHeader?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || !containerRef.current?.contains(target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen]);

  const selectedOption = options.find((opt) => opt.value === value);
  const positionClass = dropdownPosition === "top" ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]";

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      {icon ? (
        <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]">
          {icon}
        </div>
      ) : null}
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => setIsOpen(!isOpen)}
        className={`flex h-10 w-full items-center justify-between rounded-full border border-[var(--color-border)] bg-white/90 px-4 text-sm font-semibold text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/15 disabled:cursor-not-allowed disabled:opacity-60 ${
          icon ? "pl-9" : ""
        }`}
      >
        <span className="truncate pr-2">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[var(--color-text-secondary)] transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div className={`absolute left-0 z-50 min-w-full rounded-2xl border border-[var(--color-border)] bg-white p-2 shadow-[0_12px_40px_-15px_rgba(15,23,42,0.3)] ${positionClass}`}>
          <div className="flex max-h-60 flex-col overflow-y-auto">
            {dropdownHeader ? (
              <div className="mb-1 px-3 pb-1 pt-1 text-xs font-semibold text-[var(--color-text-secondary)]">
                {dropdownHeader}
              </div>
            ) : null}
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                disabled={opt.disabled}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={`w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  value === opt.value
                    ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                    : "text-[var(--color-text-secondary)] hover:bg-slate-50"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
