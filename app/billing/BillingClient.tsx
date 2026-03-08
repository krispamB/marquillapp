"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, LayoutDashboard, PenSquare, CalendarClock, TrendingUp, Sparkles, Receipt, Check, Download } from "lucide-react";
import Link from "next/link";
import Sidebar from "../dashboard/Sidebar";
import { MobileAccountSwitcherSheet, MobileBottomNav } from "../dashboard/components";
import type { UserProfile, ConnectedAccount, Tier } from "../lib/types";

type Invoice = {
    id: string;
    createdAt: string;
    amount: number;
    status: string;
};

type ActiveTier = {
    id: string;
    name: string;
    isDefault?: boolean;
};

const navItems = [
    { label: "Overview", active: false, href: "/dashboard", icon: <LayoutDashboard className="h-4 w-4" /> },
    { label: "Posts", active: false, href: "/posts", icon: <PenSquare className="h-4 w-4" /> },
    { label: "Calendar", active: false, disabled: true, icon: <CalendarClock className="h-4 w-4" /> },
    { label: "Analytics", active: false, disabled: true, icon: <TrendingUp className="h-4 w-4" /> },
];

function getInitials(name: string, email: string) {
    const cleaned = name.trim();
    if (cleaned.length > 0) {
        const parts = cleaned.split(/\s+/).filter(Boolean);
        if (parts.length === 1) {
            return parts[0].slice(0, 2).toUpperCase();
        }
        return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
    }
    return email.slice(0, 2).toUpperCase();
}

export default function BillingClient({
    user,
    connectedAccounts,
    primaryAccountId,
}: {
    user: UserProfile;
    connectedAccounts: ConnectedAccount[];
    primaryAccountId?: string;
}) {
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>(
        primaryAccountId ?? connectedAccounts[0]?.id,
    );
    const [isMobileAccountSheetOpen, setIsMobileAccountSheetOpen] = useState(false);

    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [tiers, setTiers] = useState<Tier[]>([]);
    const [activePlan, setActivePlan] = useState<ActiveTier | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const initials = getInitials(user.name, user.email);

    useEffect(() => {
        const loadBillingData = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3500/api/v1";

                const [tiersRes, invoicesRes] = await Promise.all([
                    fetch(`${apiBase}/tiers/active`, { credentials: "include" }),
                    fetch(`${apiBase}/payment/invoices`, { credentials: "include" }).catch(() => null),
                ]);

                if (tiersRes.ok) {
                    const tiersData = await tiersRes.json();
                    const items = Array.isArray(tiersData.data) ? tiersData.data : Array.isArray(tiersData) ? tiersData : [];
                    setTiers(items);
                }

                if (invoicesRes && invoicesRes.ok) {
                    const invoicesData = await invoicesRes.json();
                    if (Array.isArray(invoicesData?.items)) {
                        setInvoices(invoicesData.items);
                    }
                }

            } catch (err) {
                setError(err instanceof Error ? err.message : "Unable to load billing info");
            } finally {
                setIsLoading(false);
            }
        };

        void loadBillingData();
    }, [user]);

    const formatDate = (dateString: string) => {
        return new Intl.DateTimeFormat('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        }).format(new Date(dateString));
    };

    const activeId = activePlan?.id ?? user?.tier?._id;
    const tierMatch = tiers.find((t: Tier) => t._id === activeId) ||
        tiers.find((t: Tier) => t.isDefault);

    const defaultFeatures = [
        "Connect up to 1 LinkedIn account",
        "Generate AI posts instantly",
        "Basic post analytics",
    ];
    // @ts-ignore - metadata.features is present in API response but absent from TierMetadata type
    const activePlanFeatures = (tierMatch?.metadata as any)?.features ?? defaultFeatures;
    const planName = activePlan?.name ?? tierMatch?.name ?? user?.tier?.name ?? "Free";

    return (
        <div className="relative min-h-screen bg-[var(--color-background)] font-sans text-[var(--color-text-primary)]">
            {/* Decorative Gradients */}
            <div className="pointer-events-none fixed left-1/2 top-0 h-[600px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-primary)]/10 blur-[120px]" />
            <div className="pointer-events-none fixed bottom-0 left-0 h-96 w-96 -translate-x-1/4 translate-y-1/4 rounded-full bg-[var(--color-accent)]/15 blur-[120px]" />

            <div className="mx-auto flex w-full max-w-[1920px] justify-center lg:justify-start">
                <div className="w-full lg:max-w-none">
                    <div
                        className={`relative ${sidebarCollapsed
                            ? "md:pl-[136px] lg:pl-[156px]"
                            : "md:pl-[276px] lg:pl-[296px]"
                            }`}
                    >
                        <Sidebar
                            user={{ ...user, initials }}
                            items={navItems}
                            accounts={connectedAccounts}
                            primaryAccountIndex={0}
                            selectedAccountId={selectedAccountId}
                            collapsed={sidebarCollapsed}
                            onToggle={() => setSidebarCollapsed((value) => !value)}
                            showChrome
                            onSelectAccount={setSelectedAccountId}
                            isConnectMenuOpen={false}
                            onToggleConnectMenu={() => { }}
                            onConnectLinkedIn={async () => { }}
                            onSubscriptionLoaded={(data) => {
                                if (data?.tier) {
                                    setActivePlan(data.tier);
                                }
                            }}
                        />

                        <main className="relative mx-auto max-w-5xl px-6 py-12 sm:px-8">
                            <header className="mb-10 flex items-center justify-between">
                                <div>
                                    <h1 className="text-3xl font-bold tracking-tight text-[var(--color-text-primary)] font-[var(--font-sora)]">
                                        Billing & Plan
                                    </h1>
                                    <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                                        Manage your subscription, features, and past invoices.
                                    </p>
                                </div>
                            </header>

                            {isLoading ? (
                                <div className="flex justify-center py-20">
                                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--color-primary)]/30 border-t-[var(--color-primary)]" />
                                </div>
                            ) : error ? (
                                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center text-rose-600">
                                    {error}
                                </div>
                            ) : (
                                <div className="flex flex-col gap-10">
                                    {/* Active Plan Card */}
                                    <div className="relative overflow-hidden rounded-[2rem] border border-[var(--color-border)] bg-white p-8 shadow-xl shadow-slate-200/50 sm:p-10">
                                        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[var(--color-primary)]/10 blur-3xl" />
                                        <div className="pointer-events-none absolute bottom-0 left-0 h-32 w-32 -translate-x-1/2 translate-y-1/2 rounded-full bg-[var(--color-accent)]/15 blur-2xl" />

                                        <div className="relative flex flex-col md:flex-row md:justify-between md:items-start gap-8">
                                            <div className="flex flex-col flex-1">
                                                <div className="flex items-center gap-4 mb-6">
                                                    <div className="flex items-center justify-center p-3 rounded-2xl bg-[var(--color-primary)]/10 text-[var(--color-primary)] ring-1 ring-[var(--color-primary)]/20 shadow-sm">
                                                        <Sparkles className="h-6 w-6" />
                                                    </div>
                                                    <div>
                                                        <h2 className="text-2xl font-bold font-[var(--font-sora)] capitalize text-[#12111A]">
                                                            {planName} plan
                                                        </h2>
                                                        <p className="text-sm font-medium text-[var(--color-text-secondary)]">
                                                            Your current subscription
                                                        </p>
                                                    </div>
                                                </div>

                                                {activePlanFeatures.length > 0 && (
                                                    <div className="mt-4">
                                                        <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                            {activePlanFeatures.map((feature: string, i: number) => (
                                                                <li key={i} className="flex items-start gap-3 text-[15px] font-medium text-[var(--color-text-secondary)]">
                                                                    <span className="flex mt-0.5 h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                                                                        <Check className="h-3 w-3 stroke-[3]" />
                                                                    </span>
                                                                    <span className="leading-snug">{feature}</span>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="shrink-0 pt-2 lg:pt-0">
                                                <Link
                                                    href="/pricing"
                                                    className="inline-flex w-full sm:w-auto items-center justify-center rounded-full bg-[#1C1B27] px-6 py-2.5 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_rgba(28,27,39,0.55)] transition-all hover:bg-slate-800 hover:-translate-y-0.5"
                                                >
                                                    Upgrade plan
                                                </Link>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Invoices Section */}
                                    <div>
                                        <h3 className="text-xl font-bold tracking-tight text-[#12111A] font-[var(--font-sora)] mb-6">
                                            Invoices
                                        </h3>

                                        <div className="overflow-hidden rounded-[24px] border border-slate-100 bg-white shadow-sm ring-1 ring-slate-900/5">
                                            <div className="overflow-x-auto">
                                                <table className="w-full text-left text-[14px] text-[var(--color-text-secondary)] border-collapse whitespace-nowrap">
                                                    <thead className="bg-white border-b border-slate-100">
                                                        <tr>
                                                            <th className="px-6 py-5 font-medium text-[var(--color-text-secondary)] w-[30%]">Date</th>
                                                            <th className="px-6 py-5 font-medium text-[var(--color-text-secondary)] w-[30%]">Total</th>
                                                            <th className="px-6 py-5 font-medium text-[var(--color-text-secondary)] w-[40%]">Status</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100">
                                                        {invoices.length > 0 ? invoices.map((invoice) => {
                                                            const isPaid = invoice.status?.toLowerCase() === "succeeded" || invoice.status?.toLowerCase() === "paid";

                                                            return (
                                                                <tr key={invoice.id} className="transition-colors hover:bg-slate-50/50">
                                                                    <td className="px-6 py-5 font-medium text-[#12111A]">
                                                                        {formatDate(invoice.createdAt)}
                                                                    </td>
                                                                    <td className="px-6 py-5 font-medium text-[#12111A]">
                                                                        ${(invoice.amount / 100).toFixed(2)}
                                                                    </td>
                                                                    <td className="px-6 py-5">
                                                                        <div className={`inline-flex items-center rounded-full px-3 py-1 text-[13px] font-medium ${isPaid ? 'bg-emerald-100/60 text-emerald-600' : 'bg-slate-100 text-slate-600'}`}>
                                                                            {isPaid ? "Paid" : invoice.status}
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            );
                                                        }) : (
                                                            <tr>
                                                                <td colSpan={3} className="px-6 py-12 text-center text-slate-400">
                                                                    No invoices found.
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    </div>

                                </div>
                            )}
                        </main>
                    </div>
                </div>
            </div>
            <MobileAccountSwitcherSheet
                isOpen={isMobileAccountSheetOpen}
                accounts={connectedAccounts}
                selectedAccountId={selectedAccountId}
                onClose={() => setIsMobileAccountSheetOpen(false)}
                onSelectAccount={setSelectedAccountId}
            />
            <MobileBottomNav items={navItems} />
        </div>
    );
}
