"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, LayoutDashboard, PenSquare, CalendarClock, TrendingUp } from "lucide-react";
import Link from "next/link";
import Sidebar from "../dashboard/Sidebar";
import { MobileAccountSwitcherSheet, MobileBottomNav } from "../dashboard/components";
import type { UserProfile, ConnectedAccount } from "../lib/types";

type Tier = {
    _id: string;
    name: string;
    isActive: boolean;
    isDefault: boolean;
    metadata: {
        features: string[];
        description?: string;
    };
    monthlyPrice: number;
    polarMonthlyPriceId?: string;
    paddleMonthlyPriceId?: string;
};



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

const navItems = [
    { label: "Overview", active: false, href: "/dashboard", icon: <LayoutDashboard className="h-4 w-4" /> },
    { label: "Posts", active: false, href: "/posts", icon: <PenSquare className="h-4 w-4" /> },
    { label: "Calendar", active: false, disabled: true, icon: <CalendarClock className="h-4 w-4" /> },
    { label: "Analytics", active: false, disabled: true, icon: <TrendingUp className="h-4 w-4" /> },
];

export default function PricingClient({
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

    const [tiers, setTiers] = useState<Tier[]>([]);
    const [activeSubscriptionTierId, setActiveSubscriptionTierId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const initials = getInitials(user.name, user.email);

    useEffect(() => {
        const fetchTiers = async () => {
            try {
                const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3500/api/v1";
                const res = await fetch(`${apiBase}/tiers/active`, {
                    credentials: "include",
                });

                if (!res.ok) {
                    throw new Error("Failed to fetch pricing plans");
                }

                const payload = await res.json();
                const data = Array.isArray(payload.data) ? payload.data : Array.isArray(payload) ? payload : [];
                const sorted = data.sort((a: Tier, b: Tier) => a.monthlyPrice - b.monthlyPrice);
                const itemsToDisplay = sorted.filter((t: Tier) => t.monthlyPrice > 0 || t.isDefault);

                setTiers(itemsToDisplay);
            } catch (err) {
                setError(err instanceof Error ? err.message : "Unable to load pricing.");
            } finally {
                setIsLoading(false);
            }
        };

        void fetchTiers();
    }, []);

    useEffect(() => {
        const fetchSubscription = async () => {
            try {
                const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3500/api/v1";
                const res = await fetch(`${apiBase}/payment/subscription`, {
                    credentials: "include",
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data?.tier?.id) {
                        setActiveSubscriptionTierId(data.tier.id);
                    }
                }
            } catch {
                // Safely ignore, fallback to user tier logic
            }
        };

        void fetchSubscription();
    }, []);

    const handleCheckout = (tier: Tier) => {
        if (!tier.paddleMonthlyPriceId) {
            setError("This plan is not available for purchase right now.");
            return;
        }
        const params = new URLSearchParams({
            priceId: tier.paddleMonthlyPriceId,
            tierName: tier.name,
            monthlyPrice: String(tier.monthlyPrice),
        });
        const landingUrl = process.env.NEXT_PUBLIC_LANDING ?? "http://localhost:3001";
        window.location.href = `${landingUrl}/checkout?${params.toString()}`;
    };

    return (
        <div className="relative min-h-screen bg-[var(--color-background)] font-sans text-[var(--color-text-primary)]">
            {/* Decorative Gradients */}
            <div className="pointer-events-none fixed left-1/2 top-0 h-[600px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-primary)]/10 blur-[120px]" />
            <div className="pointer-events-none fixed bottom-0 left-0 h-96 w-96 -translate-x-1/4 translate-y-1/4 rounded-full bg-[var(--color-accent)]/15 blur-[120px]" />
            <div className="pointer-events-none fixed right-0 top-1/4 h-80 w-80 translate-x-1/4 rounded-full bg-[#EC4899]/10 blur-[120px]" />

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
                            isConnectingLinkedIn={false}
                            onToggleConnectMenu={() => { }}
                            onConnectLinkedIn={async () => { }}
                        />

                        <main className="relative mx-auto max-w-7xl px-6 py-16 sm:px-8">
                            <header className="mb-16 flex flex-col items-center text-center">
                                <Link
                                    href="/dashboard"
                                    className="group mb-8 inline-flex items-center gap-2 rounded-full bg-white/60 px-4 py-2 text-sm font-semibold text-[var(--color-text-secondary)] shadow-sm backdrop-blur-md transition hover:bg-white hover:text-[var(--color-primary)]"
                                >
                                    <ChevronLeft className="h-4 w-4 transition group-hover:-translate-x-1" />
                                    Back to Dashboard
                                </Link>
                                <h1 className="text-4xl font-bold tracking-tight text-[var(--color-text-primary)] sm:text-5xl font-sora">
                                    Simple, transparent pricing
                                </h1>
                                <p className="mt-4 max-w-2xl text-lg text-[var(--color-text-secondary)]">
                                    Choose the perfect plan to scale your LinkedIn content strategy.
                                </p>
                            </header>

                            {isLoading ? (
                                <div className="flex justify-center py-20">
                                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--color-primary)]/30 border-t-[var(--color-primary)]" />
                                </div>
                            ) : error ? (
                                <div className="mx-auto max-w-md rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center text-rose-600">
                                    {error}
                                </div>
                            ) : (
                                <div className="mx-auto grid max-w-6xl gap-8 sm:grid-cols-2 lg:grid-cols-3 items-center">
                                    {tiers.filter((t) => !t.isDefault).map((tier) => {
                                        const isCreator = tier.name.toLowerCase() === "creator";
                                        const description = tier.metadata?.description || "";

                                        const isCurrentPlan = activeSubscriptionTierId
                                            ? activeSubscriptionTierId === tier._id
                                            : user?.tier?._id === tier._id;

                                        return (
                                            <div
                                                key={tier._id}
                                                className={`relative flex h-full flex-col rounded-[2.5rem] bg-white p-8 transition-transform hover:-translate-y-1 sm:p-10 ${isCreator
                                                    ? "border-2 border-[var(--color-primary)] shadow-[0_30px_60px_-15px_rgba(91,92,246,0.15)] ring-4 ring-[var(--color-primary)]/10"
                                                    : "border border-[var(--color-border)] shadow-xl shadow-slate-200/50"
                                                    }`}
                                            >
                                                <div className="mb-6">
                                                    <div className="flex items-center justify-between">
                                                        <h3 className="text-2xl font-bold font-sora capitalize text-[#12111A]">
                                                            {tier.name}
                                                        </h3>
                                                        {isCreator && (
                                                            <span className="rounded-full bg-[var(--color-primary)]/10 px-3 py-1 text-xs font-semibold tracking-wide text-[var(--color-primary)] shadow-sm">
                                                                Most popular
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="mt-4 flex items-baseline gap-1 text-[#12111A]">
                                                        <span className="text-5xl font-semibold tracking-tight">${tier.monthlyPrice}</span>
                                                        <span className="text-sm font-medium text-[var(--color-text-secondary)]">/month</span>
                                                    </div>
                                                    <p className="mt-4 text-sm font-medium text-[var(--color-text-secondary)] h-10 leading-relaxed">
                                                        {description}
                                                    </p>
                                                </div>

                                                <button
                                                    onClick={() => handleCheckout(tier)}
                                                    disabled={isCurrentPlan}
                                                    className={`mt-2 mb-8 w-full rounded-full py-3 text-sm font-semibold transition-all ${isCurrentPlan
                                                        ? "bg-slate-100 text-[var(--color-text-secondary)] cursor-not-allowed"
                                                        : isCreator
                                                            ? "bg-[#1C1B27] text-white hover:bg-slate-800 shadow-[0_18px_40px_-26px_rgba(28,27,39,0.55)] hover:-translate-y-0.5 disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:-translate-y-0"
                                                            : "border border-[var(--color-border)] bg-transparent text-[var(--color-text-primary)] hover:border-slate-300 hover:bg-slate-50 disabled:opacity-70 disabled:cursor-not-allowed"
                                                        }`}
                                                >
                                                    {isCurrentPlan ? "Current Plan" : "Upgrade"}
                                                </button>

                                                <ul className="flex flex-1 flex-col gap-4 text-sm font-medium text-[var(--color-text-secondary)]">
                                                    {tier.metadata?.features?.map((feature, i) => (
                                                        <li key={i} className="flex items-center gap-3">
                                                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)]/10">
                                                                <div className="h-2 w-2 rounded-full bg-[var(--color-primary)]" />
                                                            </span>
                                                            {feature}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        );
                                    })}
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
