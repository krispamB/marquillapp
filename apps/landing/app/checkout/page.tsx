import type { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import CheckoutContent from './CheckoutContent';

export const metadata: Metadata = {
  title: 'Checkout',
  description: 'Complete your Marquill subscription.',
  robots: { index: false, follow: false },
};

function CheckoutSkeleton() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-accent border-t-transparent" />
      <span className="ml-3 text-sm text-ink-500">Loading checkout…</span>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <main className="mx-auto max-w-2xl px-4 sm:px-6 pt-16 pb-20">
        <div className="mb-10 text-center">
          <span className="ff-mono text-[12px] text-ink-400">_ secure checkout</span>
          <h1 className="mt-3 text-3xl font-bold tracking-[-0.025em] text-ink-900">
            Complete your subscription
          </h1>
          <p className="mt-2 text-sm text-ink-500">
            Powered by Paddle · 256-bit SSL encryption
          </p>
        </div>

        <div className="rounded-[24px] border border-line bg-surface p-6 shadow-lg sm:p-10">
          <Suspense fallback={<CheckoutSkeleton />}>
            <CheckoutContent />
          </Suspense>
        </div>

        <p className="mt-6 text-center text-xs text-ink-500">
          30-day money-back guarantee ·{' '}
          <Link href="/refund" className="underline hover:text-ink-900">
            Refund policy
          </Link>{' '}
          ·{' '}
          <Link href="/tsc" className="underline hover:text-ink-900">
            Terms of service
          </Link>
        </p>
      </main>
    </div>
  );
}
