"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { ChevronDown, ChevronLeft, Linkedin, Plus, Settings } from "lucide-react";
import { Card, NavItem, PillButton, UserAvatar } from "./components";
import type { UserProfile } from "../lib/types";

type SidebarUser = {
  initials: string;
} & UserProfile;

type SidebarItem = {
  label: string;
  icon: ReactNode;
  active?: boolean;
};

type SidebarAccount = {
  name: string;
  avatarUrl?: string;
  initials: string;
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
                <div className="grid h-10 w-10 place-items-center rounded-full bg-[var(--color-secondary)] text-sm font-semibold text-white">
                  {primaryAccount.initials}
                </div>
                <div>
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {primaryAccount.name}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                    <Linkedin className="h-3.5 w-3.5 text-[#0A66C2]" />
                    <span>LinkedIn account</span>
                  </div>
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
                  {accounts.map((account) => (
                    <div
                      key={account.name}
                      className="flex items-center justify-between rounded-2xl border border-[var(--color-border)] bg-white/80 px-3 py-2"
                    >
                      <div className="flex items-center gap-3">
                        <div className="grid h-9 w-9 place-items-center rounded-full bg-[var(--color-secondary)] text-xs font-semibold text-white">
                          {account.initials}
                        </div>
                        <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                          {account.name}
                        </p>
                      </div>
                      <Linkedin className="h-4 w-4 text-[#0A66C2]" />
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
