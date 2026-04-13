"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { CheckoutEventNames, usePaddle } from "../hooks/usePaddle";
import type { PaddleEventData } from "@paddle/paddle-js";

interface CheckoutClientProps {
    priceId: string;
    tierName: string;
    monthlyPrice?: number;
}

export default function CheckoutClient({ priceId, tierName, monthlyPrice }: CheckoutClientProps) {
    const router = useRouter();
    const containerRef = useRef<HTMLDivElement>(null);
    const [checkoutOpened, setCheckoutOpened] = useState(false);

    const handleEvent = (event: PaddleEventData) => {
        if (event.name === CheckoutEventNames.CHECKOUT_COMPLETED) {
            router.push("/dashboard");
        } else if (event.name === CheckoutEventNames.CHECKOUT_CLOSED) {
            router.push("/pricing");
        }
    };

    const paddle = usePaddle(handleEvent);

    useEffect(() => {
        if (!paddle || !containerRef.current || checkoutOpened) return;

        paddle.Checkout.open({
            displayMode: "inline",
            container: containerRef.current,
            items: [{ priceId, quantity: 1 }],
            frameStyle: "width:100%; min-width:312px; background:transparent; border:0;",
            frameInitialHeight: 450,
        });

        setCheckoutOpened(true);
    }, [paddle, priceId, checkoutOpened]);

    return (
        <div className="relative min-h-screen bg-[var(--color-background)] font-sans text-[var(--color-text-primary)]">
            {/* Decorative Gradients */}
            <div className="pointer-events-none fixed left-1/2 top-0 h-[600px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-primary)]/10 blur-[120px]" />
            <div className="pointer-events-none fixed bottom-0 left-0 h-96 w-96 -translate-x-1/4 translate-y-1/4 rounded-full bg-[var(--color-accent)]/15 blur-[120px]" />
            <div className="pointer-events-none fixed right-0 top-1/4 h-80 w-80 translate-x-1/4 rounded-full bg-[#EC4899]/10 blur-[120px]" />

            <main className="relative mx-auto max-w-2xl px-6 py-16 sm:px-8">
                <Link
                    href="/pricing"
                    className="group mb-10 inline-flex items-center gap-2 rounded-full bg-white/60 px-4 py-2 text-sm font-semibold text-[var(--color-text-secondary)] shadow-sm backdrop-blur-md transition hover:bg-white hover:text-[var(--color-primary)]"
                >
                    <ChevronLeft className="h-4 w-4 transition group-hover:-translate-x-1" />
                    Back to Pricing
                </Link>

                <header className="mb-8">
                    <h1 className="text-3xl font-bold tracking-tight font-sora text-[var(--color-text-primary)] sm:text-4xl">
                        Complete your purchase
                    </h1>
                    {tierName && (
                        <p className="mt-2 text-[var(--color-text-secondary)]">
                            You&apos;re upgrading to the{" "}
                            <span className="font-semibold text-[var(--color-text-primary)] capitalize">
                                {tierName}
                            </span>{" "}
                            plan
                            {monthlyPrice !== undefined && (
                                <> &mdash; <span className="font-semibold">${monthlyPrice}/month</span></>
                            )}
                        </p>
                    )}
                </header>

                <div className="rounded-[2rem] border border-[var(--color-border)] bg-white p-2 shadow-xl shadow-slate-200/50">
                    {!checkoutOpened && (
                        <div className="flex items-center justify-center py-20">
                            <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--color-primary)]/30 border-t-[var(--color-primary)]" />
                        </div>
                    )}
                    <div ref={containerRef} />
                </div>
            </main>
        </div>
    );
}
