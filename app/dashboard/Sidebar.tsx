"use client";

import type { ReactNode } from "react";
import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { ChevronLeft, Info, Plus, RefreshCw, Settings, LogOut, Sparkles, CreditCard, Bug } from "lucide-react";
import BugReportModal from "./BugReportModal";
import {
  Card,
  NavItem,
  OrgAvatar,
  Trash2,
  UserAvatar,
} from "./components";
import type {
  ConnectedAccount,
  UserProfile,
} from "../lib/types";

type SidebarUser = {
  initials: string;
} & UserProfile;

type SidebarItem = {
  label: string;
  icon: ReactNode;
  active?: boolean;
  href?: string;
  disabled?: boolean;
};

export default function Sidebar({
  user,
  items,
  accounts,
  selectedAccountId,
  showAccounts = true,
  collapsed = false,
  onToggle,
  showChrome = true,
  isConnectMenuOpen = false,
  isConnectingLinkedIn = false,
  isConnectingOrg = false,
  hasPersonalAccount = false,
  onToggleConnectMenu,
  onConnectLinkedIn,
  onConnectLinkedInOrg,
  onSelectAccount,
  onRemoveAccount,
  onSubscriptionLoaded,
}: {
  user: SidebarUser;
  items: SidebarItem[];
  accounts: ConnectedAccount[];
  selectedAccountId?: string;
  showAccounts?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
  showChrome?: boolean;
  isConnectMenuOpen?: boolean;
  isConnectingLinkedIn?: boolean;
  isConnectingOrg?: boolean;
  hasPersonalAccount?: boolean;
  onToggleConnectMenu?: () => void;
  onConnectLinkedIn?: () => void;
  onConnectLinkedInOrg?: () => void;
  onSelectAccount?: (accountId: string) => void;
  onRemoveAccount?: (accountId: string) => void;
  onSubscriptionLoaded?: (data: { tier?: { id: string; name: string; isDefault?: boolean } | null }) => void;
}) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isBugModalOpen, setIsBugModalOpen] = useState(false);
  const [isDefaultTier, setIsDefaultTier] = useState(false);
  const [tierName, setTierName] = useState("Free plan");
  const settingsRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3500/api/v1";
    fetch(`${apiBase}/payment/subscription`, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch subscription tier");
        return res.json();
      })
      .then((data) => {
        if (onSubscriptionLoaded) {
          onSubscriptionLoaded(data);
        }
        if (data?.tier?.name) {
          setTierName(`${data.tier.name} plan`);
        }
        if (data?.tier?.isDefault !== undefined) {
          setIsDefaultTier(data.tier.isDefault);
        }
      })
      .catch((err) => console.error("Error fetching subscription tier:", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        (settingsRef.current && settingsRef.current.contains(target)) ||
        (popoverRef.current && popoverRef.current.contains(target))
      ) {
        return;
      }
      setIsSettingsOpen(false);
    };
    if (isSettingsOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [isSettingsOpen]);

  const handleLogout = () => {
    document.cookie.split(";").forEach((c) => {
      document.cookie = c
        .replace(/^ +/, "")
        .replace(/=.*/, `=;expires=${new Date(0).toUTCString()};path=/`);
    });
    window.location.href = process.env.NEXT_PUBLIC_LANDING || "http://localhost:3001";
  };

  const providerLabel = (account: ConnectedAccount) => {
    if (account.accountType === "ORGANIZATION") return "LinkedIn Page";
    switch (account.provider) {
      case "LINKEDIN":
        return "LinkedIn account";
      default:
        return "Connected account";
    }
  };

  const initialsFromName = (name?: string, vanityName?: string) => {
    const cleaned = name?.trim() ?? "";
    if (cleaned.length > 0) {
      const parts = cleaned.split(/\s+/).filter(Boolean);
      if (parts.length === 1) {
        return parts[0].slice(0, 2).toUpperCase();
      }
      return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
    }
    return (vanityName ?? "").slice(0, 2).toUpperCase();
  };

  const accessExpiryLabel = (iso?: string) => {
    if (!iso) {
      return null;
    }
    const expiresAt = new Date(iso);
    if (Number.isNaN(expiresAt.getTime())) {
      return null;
    }
    const today = new Date();
    const diffMs = expiresAt.getTime() - today.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const label = diffDays <= 0 ? "Access expired" : `Access ends in ${diffDays} days`;
    const isDanger = diffDays <= 7;
    return { label, isDanger };
  };

  const accountAvatarWithProviderBadge = ({
    account,
    initials,
    sizeClass,
    textClass,
  }: {
    account: ConnectedAccount;
    initials: string;
    sizeClass: string;
    textClass: string;
  }) => {
    if (account.accountType === "ORGANIZATION") {
      return (
        <OrgAvatar
          name={account.displayName ?? initials}
          logoUrl={account.avatarUrl}
          sizeClass={sizeClass}
          textClass={textClass}
        />
      );
    }
    return (
      <div className="relative w-fit">
        <UserAvatar
          initials={initials}
          avatarUrl={account.avatarUrl}
          sizeClass={sizeClass}
          textClass={textClass}
        />
        {account.provider === "LINKEDIN" ? (
          <span className="absolute -bottom-1 -right-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-white bg-white shadow-[0_6px_16px_-8px_rgba(15,23,42,0.45)]">
            <img
              src="/LinkedIn_Icon_1.webp"
              alt="LinkedIn"
              className="h-3.5 w-3.5 object-contain"
            />
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <aside
      className={`hidden md:fixed md:left-0 md:top-0 md:z-30 md:flex md:h-screen ${collapsed ? "md:w-[120px] lg:w-[140px]" : "md:w-[260px] lg:w-[280px]"
        }`}
    >
      <Card
        className={`flex h-full w-full flex-col gap-6 overflow-y-auto rounded-none p-5 ${collapsed ? "items-center px-3" : ""
          }`}
      >
        <div className="flex w-full items-center justify-between">
          <div className={`${collapsed ? "w-full" : ""}`}>
            <img
              src={
                collapsed
                  ? "https://res.cloudinary.com/dnpvndlmy/image/upload/q_auto/f_auto/v1775562587/marquill/icon_ngg31p.svg"
                  : "https://res.cloudinary.com/dnpvndlmy/image/upload/q_auto/f_auto/v1775561659/marquill/logo_nwvdon.svg"
              }
              alt="Marquill"
              className={`${collapsed ? "mx-auto h-10 w-10" : "h-8 w-auto"}`}
            />
          </div>
          {showChrome && onToggle ? (
            <button
              className="grid h-8 w-8 place-items-center rounded-full bg-white/70 text-[var(--color-text-secondary)] shadow-[0_12px_24px_-18px_rgba(15,23,42,0.45)] transition hover:text-[var(--color-primary)]"
              onClick={onToggle}
              type="button"
            >
              <ChevronLeft
                className={`h-4 w-4 transition ${collapsed ? "rotate-180" : ""
                  }`}
              />
            </button>
          ) : null}
        </div>


        <div className="flex w-full flex-col gap-2">
          {collapsed ? null : (
            <p className="px-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
              Main
            </p>
          )}
          <div className={`flex flex-col gap-2 ${collapsed ? "items-center" : ""}`}>
            {items.map((item) => (
              <NavItem
                key={item.label}
                label={item.label}
                active={item.active}
                icon={item.icon}
                href={item.href}
                disabled={item.disabled}
                collapsed={collapsed}
              />
            ))}
          </div>
        </div>

        {showAccounts && !collapsed ? (
          <div className="w-full flex flex-col gap-3">
            {/* ── Section header ── */}
            <div className="flex items-center justify-between px-1">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                Connected accounts
              </p>
              <div className="flex items-center gap-0.5">
                {/* Info */}
                <button
                  type="button"
                  title="Connect your LinkedIn account to start publishing. Use + to add organization pages."
                  className="grid h-7 w-7 place-items-center rounded-full text-[var(--color-text-secondary)] hover:bg-white/70 transition"
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
                {/* Reconnect — personal accounts only, always runs OAuth */}
                <button
                  type="button"
                  disabled={!hasPersonalAccount || isConnectingLinkedIn}
                  onClick={onConnectLinkedIn}
                  title="Re-authenticate your LinkedIn account"
                  className="grid h-7 w-7 place-items-center rounded-full text-[var(--color-text-secondary)] hover:bg-white/70 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
                {/* Plus — connect org page, disabled when no accounts at all */}
                <button
                  type="button"
                  disabled={accounts.length === 0}
                  onClick={onConnectLinkedInOrg}
                  title="Connect an organization page"
                  className="grid h-7 w-7 place-items-center rounded-full text-[var(--color-text-secondary)] hover:bg-white/70 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* ── Account list OR empty state ── */}
            {accounts.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                {accounts.map((account) => {
                  const isActive = account.id === (selectedAccountId ?? accounts[0]?.id);
                  const expiry = accessExpiryLabel(account.accessTokenExpiresAt);
                  const subtitle = expiry
                    ? expiry.label
                    : account.vanityName
                    ? `@${account.vanityName}`
                    : providerLabel(account);
                  return (
                    <div
                      key={account.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelectAccount?.(account.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelectAccount?.(account.id);
                        }
                      }}
                      className={`group flex items-center gap-3 rounded-2xl border px-3 py-2.5 cursor-pointer transition ${
                        isActive
                          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10"
                          : "border-transparent hover:border-[var(--color-border)] hover:bg-white/70"
                      }`}
                    >
                      {/* Avatar */}
                      {accountAvatarWithProviderBadge({
                        account,
                        initials: initialsFromName(account.displayName, account.vanityName),
                        sizeClass: "h-11 w-11",
                        textClass: "text-sm",
                      })}

                      {/* Name + subtitle */}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
                          {account.displayName ?? providerLabel(account)}
                        </p>
                        <p className={`text-[11px] truncate ${expiry?.isDanger ? "font-semibold text-rose-500" : "text-[var(--color-text-secondary)]"}`}>
                          {subtitle}
                        </p>
                      </div>

                      {/* Trash — hover only */}
                      {onRemoveAccount ? (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onRemoveAccount(account.id); }}
                          className="ml-auto shrink-0 grid h-7 w-7 place-items-center rounded-full text-[var(--color-text-secondary)] opacity-0 transition group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-500"
                          aria-label={`Remove ${account.displayName ?? providerLabel(account)}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Empty state — matches image's "More channels" style */
              <button
                type="button"
                onClick={onConnectLinkedIn}
                className="flex items-center gap-3 rounded-2xl border border-dashed border-[var(--color-border)] px-3 py-2.5 text-left transition hover:border-[var(--color-primary)]/45 hover:bg-white/70"
              >
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--color-border)] bg-white/80">
                  <Plus className="h-5 w-5 text-[var(--color-text-secondary)]" />
                </span>
                <span className="text-sm font-semibold text-[var(--color-text-secondary)]">Add account</span>
              </button>
            )}
          </div>
        ) : null}

        <div className="mt-auto w-full relative" ref={settingsRef}>
          <button
            onClick={() => setIsSettingsOpen((prev) => !prev)}
            className={`flex items-center ${collapsed ? "justify-center w-[46px] h-[46px] mx-auto p-0 rounded-full" : "w-full justify-between gap-1.5 p-1.5 pl-2 pr-3 rounded-[32px]"} border border-[var(--color-border)] bg-white text-[var(--color-text-primary)] shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] transition hover:bg-gray-50`}
          >
            <div className={`flex items-center min-w-0 ${collapsed ? "justify-center" : "gap-2"}`}>
              <UserAvatar
                initials={user.initials}
                avatarUrl={user.avatar}
                sizeClass={collapsed ? "h-10 w-10 shrink-0" : "h-8 w-8 shrink-0"}
                textClass="text-[12px] bg-blue-100 text-blue-700 font-semibold"
              />
              {!collapsed && (
                <div className="flex flex-col items-start text-left min-w-0 py-0.5">
                  <span className="text-[13px] font-medium leading-tight truncate w-full">{user.name}</span>
                  <span className="text-[11px] text-[var(--color-text-secondary)] leading-tight capitalize truncate w-full">{tierName.replace(' plan', '')}</span>
                </div>
              )}
            </div>
            {!collapsed && isDefaultTier && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  window.location.href = '/pricing';
                }}
                className="rounded-full border border-[var(--color-border)] bg-white px-2.5 py-1 text-[11px] font-medium text-[var(--color-text-primary)] shadow-sm transition hover:bg-gray-50 shrink-0"
              >
                Upgrade
              </span>
            )}
          </button>
        </div>
      </Card>

      {isSettingsOpen && (
        <div
          ref={popoverRef}
          className={`
            absolute z-[99] rounded-[24px] border border-[var(--color-border)] bg-white p-2.5 shadow-[0_24px_60px_-50px_rgba(15,23,42,0.35)] text-[var(--color-text-primary)]
            ${collapsed ? "bottom-5 left-[calc(100%+8px)] w-[260px]" : "bottom-[84px] left-5 w-[calc(100%-40px)]"} 
          `}
        >
          <div className="flex items-center gap-3 p-2 mb-1">
            <UserAvatar
              initials={user.initials}
              avatarUrl={user.avatar}
              sizeClass="h-10 w-10 border border-[var(--color-border)] min-w-[40px]"
              textClass="text-sm bg-blue-100 text-blue-700 font-semibold"
            />
            <div className="flex flex-col min-w-0">
              <span className="text-[15px] font-semibold text-[var(--color-text-primary)] leading-tight truncate">{user.name}</span>
              <span className="text-[13px] text-[var(--color-text-secondary)] leading-tight truncate">
                {user.email ? `@${user.email.split('@')[0]}` : `@${user.name.toLowerCase().replace(/\s+/g, '')}`}
              </span>
            </div>
          </div>
          <div className="mx-2 h-[1px] bg-gray-100 my-1"></div>
          <div className="flex flex-col gap-0.5 mt-1.5">
            <Link href="/pricing" className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-[15px] font-medium transition-colors hover:bg-gray-50 text-[var(--color-text-primary)]" onClick={() => setIsSettingsOpen(false)}>
              <Sparkles className="h-[18px] w-[18px] text-[var(--color-text-secondary)] shrink-0" />
              Upgrade plan
            </Link>
            <Link href="/billing" className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-[15px] font-medium transition-colors hover:bg-gray-50 text-[var(--color-text-primary)]" onClick={() => setIsSettingsOpen(false)}>
              <CreditCard className="h-[18px] w-[18px] text-[var(--color-text-secondary)] shrink-0" />
              Billing
            </Link>
            <button className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-[15px] font-medium transition-colors hover:bg-gray-50 text-[var(--color-text-primary)]" onClick={() => { setIsSettingsOpen(false); }}>
              <Settings className="h-[18px] w-[18px] text-[var(--color-text-secondary)] shrink-0" />
              Settings
            </button>
            <button className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-[15px] font-medium transition-colors hover:bg-gray-50 text-[var(--color-text-primary)]" onClick={() => { setIsSettingsOpen(false); setIsBugModalOpen(true); }}>
              <Bug className="h-[18px] w-[18px] text-[var(--color-text-secondary)] shrink-0" />
              Help & feedback
            </button>
          </div>
          <div className="mx-2 h-[1px] bg-gray-100 my-1.5"></div>
          <div className="mb-0.5 mt-0.5">
            <button
              onClick={handleLogout}
              className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-[15px] font-medium transition-colors hover:bg-rose-50 text-[var(--color-text-primary)] hover:text-rose-600"
            >
              <LogOut className="h-[18px] w-[18px] text-rose-500 shrink-0" />
              Log out
            </button>
          </div>
        </div>
      )
      }
      <BugReportModal isOpen={isBugModalOpen} onClose={() => setIsBugModalOpen(false)} />
    </aside >
  );
}
