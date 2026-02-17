import type { MouseEventHandler, ReactNode } from "react";
import { CalendarClock, CheckCheck, PenLine, Plug } from "lucide-react";
import type { PostStatus, UserProfile } from "../lib/types";

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
  isConnectingLinkedIn = false,
  menuId = "connect-account-menu-cta",
}: {
  isConnectMenuOpen: boolean;
  onToggleConnectMenu: () => void;
  onConnectLinkedIn: () => void;
  isConnectingLinkedIn?: boolean;
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
            onConnectLinkedIn={onConnectLinkedIn}
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
  onConnectLinkedIn,
  align = "right",
}: {
  menuId: string;
  isOpen: boolean;
  isConnectingLinkedIn?: boolean;
  onConnectLinkedIn: () => void;
  align?: "left" | "right";
}) {
  return (
    <div
      id={menuId}
      role="menu"
      aria-hidden={!isOpen}
      className={`pointer-events-none absolute top-12 z-40 h-40 w-44 transition-all duration-200 ${
        align === "right" ? "right-0" : "left-0"
      } ${isOpen ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`}
    >
      <button
        type="button"
        role="menuitem"
        onClick={onConnectLinkedIn}
        disabled={isConnectingLinkedIn}
        className={`group pointer-events-auto absolute right-2 top-2 flex h-16 w-16 items-center justify-center rounded-full border border-[var(--color-border)] bg-white/95 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.45)] backdrop-blur-md transition-all ${
          isOpen ? "scale-100" : "scale-90"
        } disabled:cursor-not-allowed disabled:opacity-70`}
        aria-label="Connect LinkedIn account"
      >
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[#0A66C2]/10">
          <img
            src="/LinkedIn_Icon_1.webp"
            alt="LinkedIn"
            className="h-5 w-5 object-contain"
          />
        </span>
      </button>
      <p
        className={`pointer-events-none absolute right-1 top-20 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-[var(--color-text-primary)] shadow-[0_10px_30px_-20px_rgba(15,23,42,0.35)] transition-all ${
          isOpen ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
        }`}
      >
        {isConnectingLinkedIn ? "Connecting..." : "LinkedIn"}
      </p>
    </div>
  );
}

export function NavItem({
  label,
  active,
  icon,
  collapsed = false,
}: {
  label: string;
  active?: boolean;
  icon: ReactNode;
  collapsed?: boolean;
}) {
  return (
    <button
      className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition ${
        active
          ? "bg-[var(--color-primary)] text-white shadow-[0_18px_35px_-26px_rgba(91,92,246,0.45)]"
          : "text-[var(--color-text-secondary)] hover:bg-white/70"
      }`}
    >
      <span className="grid h-9 w-9 place-items-center rounded-full bg-white/80 text-[var(--color-secondary)]">
        {icon}
      </span>
      {collapsed ? null : <span>{label}</span>}
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
        <p className="text-xs text-[var(--color-text-secondary)]">
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
