"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { ChevronDown, ChevronLeft, Linkedin, Plus, Settings } from "lucide-react";
import { Card, NavItem, PillButton, UserAvatar } from "./components";
import type { ConnectedAccountProvider, UserProfile } from "../lib/types";

type SidebarUser = {
  initials: string;
} & UserProfile;

type SidebarItem = {
  label: string;
  icon: ReactNode;
  active?: boolean;
};

type SidebarAccount = {
  id: string;
  provider: ConnectedAccountProvider;
  accessTokenExpiresAt?: string;
  profile: {
    name?: string;
    email?: string;
    picture?: string;
  };
};

export default function Sidebar({
  user,
  items,
  accounts,
  primaryAccountIndex = 0,
  showAccounts = true,
  collapsed = false,
  onToggle,
  showChrome = true,
}: {
  user: SidebarUser;
  items: SidebarItem[];
  accounts: SidebarAccount[];
  primaryAccountIndex?: number;
  showAccounts?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
  showChrome?: boolean;
}) {
  const [accountsExpanded, setAccountsExpanded] = useState(false);
  const primaryAccount = accounts[primaryAccountIndex] ?? accounts[0];
  const connectedAccounts = accounts.filter(
    (account) => account.profile?.name || account.profile?.email,
  );

  const providerLabel = (provider: ConnectedAccountProvider) => {
    switch (provider) {
      case "LINKEDIN":
        return "LinkedIn account";
      default:
        return "Connected account";
    }
  };

  const providerIcon = (provider: ConnectedAccountProvider, className: string) => {
    switch (provider) {
      case "LINKEDIN":
        return <Linkedin className={className} />;
      default:
        return <Linkedin className={className} />;
    }
  };

  const initialsFromName = (name?: string, email?: string) => {
    const cleaned = name?.trim() ?? "";
    if (cleaned.length > 0) {
      const parts = cleaned.split(/\s+/).filter(Boolean);
      if (parts.length === 1) {
        return parts[0].slice(0, 2).toUpperCase();
      }
      return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
    }
    return (email ?? "").slice(0, 2).toUpperCase();
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

  return (
    <aside className="sticky top-8 hidden h-fit md:flex">
      <Card
        className={`flex w-full flex-col gap-6 p-5 ${
          collapsed ? "items-center px-3" : ""
        }`}
      >
        <div className="flex w-full items-center justify-between">
          <div className={`${collapsed ? "w-full" : ""}`}>
            <img
              src={
                collapsed
                  ? "https://res.cloudinary.com/dnpvndlmy/image/upload/v1770759168/marquill/icon_at6fek.svg"
                  : "https://res.cloudinary.com/dnpvndlmy/image/upload/v1770689074/marquill/logo_bpw55v.svg"
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
                className={`h-4 w-4 transition ${
                  collapsed ? "rotate-180" : ""
                }`}
              />
            </button>
          ) : null}
        </div>

        <div className={`flex w-full items-center gap-4 ${collapsed ? "flex-col" : ""}`}>
          <UserAvatar
            initials={user.initials}
            avatarUrl={user.avatar}
            sizeClass="h-12 w-12"
            textClass="text-base"
          />
          {collapsed ? null : (
            <div>
              <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                {user.name}
              </p>
              <p className="text-xs text-[var(--color-text-secondary)]">
                {user.email}
              </p>
            </div>
          )}
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
                collapsed={collapsed}
              />
            ))}
          </div>
        </div>

        {showAccounts && !collapsed && primaryAccount ? (
          <div className="w-full">
            <button
              className="flex w-full items-center justify-between gap-3 rounded-2xl border border-[var(--color-border)] bg-white/80 px-3 py-3 text-left transition hover:-translate-y-0.5"
              onClick={() => setAccountsExpanded((value) => !value)}
              type="button"
            >
              <div className="flex items-center gap-3">
                <UserAvatar
                  initials={initialsFromName(
                    primaryAccount.profile?.name,
                    primaryAccount.profile?.email,
                  )}
                  avatarUrl={primaryAccount.profile?.picture}
                  sizeClass="h-10 w-10"
                  textClass="text-sm"
                />
                <div>
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {primaryAccount.profile?.name ?? "Connected account"}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                    {providerIcon(
                      primaryAccount.provider,
                      "h-3.5 w-3.5 text-[#0A66C2]",
                    )}
                    <span>{providerLabel(primaryAccount.provider)}</span>
                  </div>
                  {primaryAccount.profile?.email ? (
                    <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">
                      {primaryAccount.profile.email}
                    </p>
                  ) : null}
                  {(() => {
                    const expiry = accessExpiryLabel(
                      primaryAccount.accessTokenExpiresAt,
                    );
                    if (!expiry) {
                      return null;
                    }
                    return (
                      <p
                        className={`mt-1 text-[11px] font-semibold ${
                          expiry.isDanger
                            ? "text-rose-500"
                            : "text-[var(--color-text-secondary)]"
                        }`}
                      >
                        {expiry.label}
                      </p>
                    );
                  })()}
                </div>
              </div>
              <ChevronDown
                className={`h-4 w-4 text-[var(--color-text-secondary)] transition ${
                  accountsExpanded ? "rotate-180" : ""
                }`}
              />
            </button>

            {accountsExpanded ? (
              <div className="mt-3 rounded-2xl border border-[var(--color-border)] bg-white/70 p-3 shadow-[0_24px_60px_-50px_rgba(15,23,42,0.35)]">
                <p className="px-2 pb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
                  Connected accounts
                </p>
                <div className="flex flex-col gap-2">
                  {connectedAccounts.map((account) => (
                    <div
                      key={account.id}
                      className="flex items-center justify-between rounded-2xl border border-[var(--color-border)] bg-white/80 px-3 py-2"
                    >
                      <div className="flex items-center gap-3">
                        <UserAvatar
                          initials={initialsFromName(
                            account.profile?.name,
                            account.profile?.email,
                          )}
                          avatarUrl={account.profile?.picture}
                          sizeClass="h-9 w-9"
                          textClass="text-xs"
                        />
                        <div>
                          <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                            {account.profile?.name ?? "Connected account"}
                          </p>
                          {account.profile?.email ? (
                            <p className="text-[11px] text-[var(--color-text-secondary)]">
                              {account.profile.email}
                            </p>
                          ) : null}
                          {(() => {
                            const expiry = accessExpiryLabel(
                              account.accessTokenExpiresAt,
                            );
                            if (!expiry) {
                              return null;
                            }
                            return (
                              <p
                                className={`text-[11px] font-semibold ${
                                  expiry.isDanger
                                    ? "text-rose-500"
                                    : "text-[var(--color-text-secondary)]"
                                }`}
                              >
                                {expiry.label}
                              </p>
                            );
                          })()}
                        </div>
                      </div>
                      {providerIcon(account.provider, "h-4 w-4 text-[#0A66C2]")}
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex justify-end">
                  <PillButton variant="secondary" icon={<Plus className="h-4 w-4" />}>
                    Add account
                  </PillButton>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-auto w-full">
          {collapsed ? (
            <button className="grid h-12 w-12 place-items-center rounded-2xl bg-white/80 text-[var(--color-text-secondary)] shadow-[0_14px_30px_-24px_rgba(15,23,42,0.4)] transition hover:text-[var(--color-primary)]">
              <Settings className="h-4 w-4" />
            </button>
          ) : (
            <PillButton variant="secondary" icon={<Settings className="h-4 w-4" />}>
              Settings
            </PillButton>
          )}
        </div>
      </Card>
    </aside>
  );
}
