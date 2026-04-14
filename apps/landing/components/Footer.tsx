'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Logo from './Logo';

export default function Footer() {
  const pathname = usePathname();
  const currentYear = new Date().getFullYear();

  if (pathname === '/checkout') return null;

  return (
    <footer className="bg-[#0F111A] text-white" role="contentinfo">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="space-y-4">
            <Logo className="text-white" textClassName="text-white" />
            <p className="text-sm text-white/70 max-w-xs">
              Marquill is your AI LinkedIn workspace. Generate, schedule, and publish content that performs — all in one place.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-white/80 mb-4">Product</h3>
            <ul className="space-y-3 text-sm text-white/70">
              <li>
                <a href="#how-it-works" className="hover:text-white transition-colors">
                  How it works
                </a>
              </li>
              <li>
                <a href="#pricing" className="hover:text-white transition-colors">
                  Pricing
                </a>
              </li>
              <li>
                <a href="#faq" className="hover:text-white transition-colors">
                  FAQ
                </a>
              </li>
              <li>
                <Link href="/blog" className="hover:text-white transition-colors">
                  Blog
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-white/80 mb-4">Company</h3>
            <ul className="space-y-3 text-sm text-white/70">
              <li>
                <Link href="/privacy-policy" className="hover:text-white transition-colors">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/tsc" className="hover:text-white transition-colors">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link href="/refund" className="hover:text-white transition-colors">
                  Refund Policy
                </Link>
              </li>
              <li>
                <Link href="/pricing" className="hover:text-white transition-colors">
                  Pricing Details
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-white/80 mb-4">Contact</h3>
            <ul className="space-y-3 text-sm text-white/70">
              <li>Email: hello@marquill.com</li>
            </ul>
          </div>
        </div>

        <div className="mt-12 border-t border-white/10 pt-6 text-sm text-white/60 flex flex-col md:flex-row justify-between gap-4">
          <span>© {currentYear} Marquill. All rights reserved.</span>
          <span>Built for creators, agencies, and growth teams.</span>
          <a href="https://lordicon.com/">Icons by Lordicon.com</a>
        </div>
      </div>
    </footer>
  );
}
