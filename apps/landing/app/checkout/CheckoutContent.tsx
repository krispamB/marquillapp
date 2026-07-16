'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { initializePaddle, Paddle, Environments } from '@paddle/paddle-js';
import Link from 'next/link';
import { normalizeAppUrl } from '@/config/urls';

// ---------------------------------------------------------------------------
// CheckoutContent — reads query params, initialises Paddle, opens inline widget
// URL contract: /checkout?transactionId=txn_xxx
// ---------------------------------------------------------------------------
export default function CheckoutContent() {
  const params = useSearchParams();
  const transactionId = params.get('transactionId') ?? '';

  const [paddle, setPaddle] = useState<Paddle | undefined>();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  // Step 1 — initialise Paddle SDK
  useEffect(() => {
    if (!transactionId) {
      setErrorMsg('No transaction provided. Please go back and choose a plan.');
      setStatus('error');
      return;
    }

    const environment = (process.env.NEXT_PUBLIC_PADDLE_ENVIRONMENT ?? 'production') as Environments;

    initializePaddle({
      environment,
      token: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN!,
      eventCallback(event) {
        if (event.name === 'checkout.completed') {
          const appUrl = normalizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
          if (appUrl === '#') {
            setErrorMsg('Checkout completed, but the billing page could not be opened.');
            setStatus('error');
            return;
          }
          window.location.href = new URL('/billing', appUrl).toString();
        }
      },
    })
      .then((p) => setPaddle(p))
      .catch(() => {
        setErrorMsg('Failed to load checkout. Please refresh and try again.');
        setStatus('error');
      });
  }, [transactionId]);

  // Step 2 — open inline checkout once SDK is ready
  useEffect(() => {
    if (!paddle || !transactionId) return;

    paddle.Checkout.open({
      transactionId,
      settings: {
        displayMode: 'inline',
        frameTarget: 'paddle-checkout',  // matches className on container div below
        frameInitialHeight: 450,
        frameStyle:
          'width:100%;min-width:312px;background-color:transparent;border:none;',
      },
    });

    setStatus('ready');
  }, [paddle, transactionId]);

  // ── Error state ────────────────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <div className="flex flex-col items-center text-center py-8">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-8 max-w-sm w-full">
          <p className="text-sm font-semibold text-red-600 mb-2">Something went wrong</p>
          <p className="text-sm text-red-500 mb-6">{errorMsg}</p>
          <Link
            href="/#pricing"
            className="inline-flex min-h-11 items-center rounded-[10px] bg-ink-900 px-5 text-sm font-semibold text-surface transition-opacity hover:opacity-90"
          >
            ← Back to pricing
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Loading spinner — visible while Paddle iframe initialises */}
      {status === 'loading' && (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-accent border-t-transparent" />
          <span className="ml-3 text-sm text-ink-500">Loading checkout…</span>
        </div>
      )}

      {/* Paddle inline checkout container — must exist in DOM before open() */}
      <div className="paddle-checkout w-full" />
    </>
  );
}
