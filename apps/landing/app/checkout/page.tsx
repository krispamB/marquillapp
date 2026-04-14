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
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#5B5CF6] border-t-transparent" />
      <span className="ml-3 text-sm text-text-secondary">Loading checkout…</span>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-[#F6F2FF] to-[#EAF1FF]">
      <main className="mx-auto max-w-2xl px-4 sm:px-6 pt-16 pb-20">
        <div className="mb-10 text-center">
          <p className="text-sm font-semibold text-[#5B5CF6] mb-2">Secure checkout</p>
          <h1 className="text-3xl font-semibold text-text-primary">
            Complete your subscription
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            Powered by Paddle · 256-bit SSL encryption
          </p>
        </div>

        <div className="rounded-3xl border border-white/70 bg-white/80 p-6 sm:p-10 shadow-2xl">
          <Suspense fallback={<CheckoutSkeleton />}>
            <CheckoutContent />
          </Suspense>
        </div>

        <p className="mt-6 text-center text-xs text-text-secondary">
          30-day money-back guarantee ·{' '}
          <Link href="/refund" className="underline hover:text-text-primary">
            Refund policy
          </Link>{' '}
          ·{' '}
          <Link href="/tsc" className="underline hover:text-text-primary">
            Terms of service
          </Link>
        </p>
      </main>
    </div>
  );
}
