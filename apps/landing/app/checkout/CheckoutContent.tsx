'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { initializePaddle, Paddle, Environments } from '@paddle/paddle-js';
import Link from 'next/link';

// ---------------------------------------------------------------------------
// Cookie helper — reads the `user` cookie set by beta.marquill.com
// Shape: { _id, name, email, googleId, avatar, tier, ... }
// ---------------------------------------------------------------------------
function getUserFromCookie(): { name?: string; email?: string } {
  if (typeof document === 'undefined') return {};
  const raw = document.cookie
    .split('; ')
    .find((row) => row.startsWith('user='))
    ?.split('=')[1];
  if (!raw) return {};
  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    return {
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
      email: typeof parsed.email === 'string' ? parsed.email : undefined,
    };
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// CheckoutContent — reads query params, initialises Paddle, opens inline widget
// URL contract: /checkout?priceId=pri_xxx&tierName=Creator&monthlyPrice=19.99
// ---------------------------------------------------------------------------
export default function CheckoutContent() {
  const params = useSearchParams();
  const priceId = params.get('priceId') ?? '';
  const tierName = params.get('tierName') ?? 'Your plan';
  const monthlyPrice = params.get('monthlyPrice') ?? '';

  const [paddle, setPaddle] = useState<Paddle | undefined>();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  // Step 1 — initialise Paddle SDK
  useEffect(() => {
    if (!priceId) {
      setErrorMsg('No price selected. Please go back and choose a plan.');
      setStatus('error');
      return;
    }

    const environment = (process.env.NEXT_PUBLIC_PADDLE_ENVIRONMENT ?? 'production') as Environments;

    initializePaddle({
      environment,
      token: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN!,
      eventCallback(event) {
        if (event.name === 'checkout.completed') {
          window.location.href = 'https://beta.marquill.com';
        }
      },
    })
      .then((p) => setPaddle(p))
      .catch(() => {
        setErrorMsg('Failed to load checkout. Please refresh and try again.');
        setStatus('error');
      });
  }, [priceId]);

  // Step 2 — open inline checkout once SDK is ready
  useEffect(() => {
    if (!paddle || !priceId) return;

    const { name, email } = getUserFromCookie();

    paddle.Checkout.open({
      items: [{ priceId, quantity: 1 }],
      customer: email ? { email } : undefined,
      customData: name ? { name } : undefined,
      settings: {
        displayMode: 'inline',
        frameTarget: 'paddle-checkout',  // matches className on container div below
        frameInitialHeight: 450,
        frameStyle:
          'width:100%;min-width:312px;background-color:transparent;border:none;',
      },
    });

    setStatus('ready');
  }, [paddle, priceId]);

  // ── Error state ────────────────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <div className="flex flex-col items-center text-center py-8">
        <div className="rounded-2xl border border-red-100 bg-red-50 p-8 max-w-sm w-full">
          <p className="text-sm font-semibold text-red-600 mb-2">Something went wrong</p>
          <p className="text-sm text-red-500 mb-6">{errorMsg}</p>
          <Link
            href="/#pricing"
            className="inline-block rounded-full bg-[#1B1C2A] px-5 py-2.5 text-sm font-semibold text-white"
          >
            ← Back to pricing
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Plan summary card */}
      <div className="mb-8 rounded-2xl border border-[#E0E2FF] bg-[#F5F5FF] px-6 py-5 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#5B5CF6]">
            Selected plan
          </p>
          <p className="mt-1 text-xl font-semibold text-text-primary">{tierName}</p>
        </div>
        {monthlyPrice && (
          <div className="text-right">
            <span className="text-3xl font-semibold text-text-primary">${monthlyPrice}</span>
            <span className="text-sm text-text-secondary"> /mo</span>
          </div>
        )}
      </div>

      {/* Loading spinner — visible while Paddle iframe initialises */}
      {status === 'loading' && (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#5B5CF6] border-t-transparent" />
          <span className="ml-3 text-sm text-text-secondary">Loading checkout…</span>
        </div>
      )}

      {/* Paddle inline checkout container — must exist in DOM before open() */}
      <div className="paddle-checkout w-full" />
    </>
  );
}
