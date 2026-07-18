'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import MarquillLockup from './brand/MarquillLockup';
import ThemeToggle from './ThemeToggle';
import { normalizeAppUrl } from '@/config/urls';

const NAV_LINKS = [
  { label: 'Meet Mark', href: '/#meet-mark' },
  { label: 'What Mark makes', href: '/#what-mark-makes' },
  { label: 'Pricing', href: '/#pricing' },
];

export default function Header({ showThemeToggle = false }: { showThemeToggle?: boolean }) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const appUrl = normalizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);

  if (pathname === '/checkout') return null;

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-surface/90 backdrop-blur">
      <nav className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-10" aria-label="Main navigation">
        <div className="flex h-16 items-center justify-between">
          <Link href="/" className="flex-shrink-0" aria-label="Marquill home">
            <MarquillLockup size={28} />
          </Link>

          {/* Desktop nav */}
          <div className="hidden items-center gap-7 text-[14px] font-medium text-ink-700 md:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="rounded px-1 py-1 transition-colors hover:text-ink-900"
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="hidden items-center gap-3 md:flex">
            {showThemeToggle && <ThemeToggle />}
            <a
              href={appUrl}
              className="inline-flex min-h-10 items-center gap-2 rounded-[10px] bg-ink-900 px-[18px] text-[14px] font-semibold tracking-[-0.01em] text-surface transition-opacity hover:opacity-90"
            >
              Get started for free →
            </a>
          </div>

          {/* Mobile controls */}
          <div className="flex items-center gap-2 md:hidden">
            {showThemeToggle && <ThemeToggle />}
            <button
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-ink-700 transition-colors hover:bg-canvas-sub hover:text-ink-900"
              aria-expanded={mobileMenuOpen}
              aria-label="Toggle navigation menu"
              aria-controls="mobile-menu"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" aria-hidden="true">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div id="mobile-menu" className="border-t border-line py-3 md:hidden">
            <div className="space-y-1">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="block rounded-md px-3 py-3 text-base font-medium text-ink-700 transition-colors hover:bg-canvas-sub hover:text-ink-900"
                >
                  {link.label}
                </Link>
              ))}
              <a
                href={appUrl}
                onClick={() => setMobileMenuOpen(false)}
                className="mt-2 flex min-h-12 items-center justify-center rounded-[10px] bg-ink-900 px-5 text-[15px] font-semibold text-surface"
              >
                Get started for free →
              </a>
            </div>
          </div>
        )}
      </nav>
    </header>
  );
}
