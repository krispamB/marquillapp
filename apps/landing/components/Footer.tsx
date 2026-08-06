'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import MarquillLockup from './brand/MarquillLockup';

export default function Footer() {
  const pathname = usePathname();
  const currentYear = new Date().getFullYear();

  if (pathname === '/checkout') return null;

  return (
    <footer className="border-t border-line bg-surface" role="contentinfo">
      <div className="mx-auto max-w-7xl px-5 py-14 sm:px-6 lg:px-10">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
          <div className="space-y-4">
            <MarquillLockup size={28} />
            <p className="max-w-xs text-[14px] leading-relaxed text-ink-500">
              Your AI LinkedIn workspace. Just tell Mark what to post — he writes it, designs it, and ships it.
            </p>
          </div>

          <div>
            <h3 className="mb-4 text-[13px] font-semibold text-ink-900">Product</h3>
            <ul className="space-y-3 text-[14px]">
              <li><Link href="/#meet-mark" className="text-ink-500 transition-colors hover:text-ink-900">Meet Mark</Link></li>
              <li><Link href="/#what-mark-makes" className="text-ink-500 transition-colors hover:text-ink-900">What Mark makes</Link></li>
              <li><Link href="/#pricing" className="text-ink-500 transition-colors hover:text-ink-900">Pricing</Link></li>
              <li><Link href="/blog" className="text-ink-500 transition-colors hover:text-ink-900">Blog</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="mb-4 text-[13px] font-semibold text-ink-900">Company</h3>
            <ul className="space-y-3 text-[14px]">
              <li><Link href="/privacy-policy" className="text-ink-500 transition-colors hover:text-ink-900">Privacy Policy</Link></li>
              <li><Link href="/tsc" className="text-ink-500 transition-colors hover:text-ink-900">Terms of Service</Link></li>
              <li><Link href="/refund" className="text-ink-500 transition-colors hover:text-ink-900">Refund Policy</Link></li>
              <li><Link href="/pricing" className="text-ink-500 transition-colors hover:text-ink-900">Pricing Details</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="mb-4 text-[13px] font-semibold text-ink-900">Contact</h3>
            <ul className="space-y-3 text-[14px] text-ink-500">
              <li>
                <a href="mailto:hello@marquill.com" className="transition-colors hover:text-ink-900">
                  hello@marquill.com
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-line pt-7 text-[12.5px] text-ink-400 sm:flex-row sm:items-center sm:justify-between">
          <span className="ff-mono">© {currentYear} Marquill · Mark works for creators, agencies, and growth teams.</span>
          <a href="https://lordicon.com/" className="transition-colors hover:text-ink-700">Icons by Lordicon.com</a>
        </div>
      </div>
    </footer>
  );
}
