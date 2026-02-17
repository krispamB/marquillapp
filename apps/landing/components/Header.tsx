'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { normalizeAppUrl } from '@/config/urls';

const navItems = [
  { label: 'How it works', targetId: 'how-it-works' },
  { label: 'Pricing', targetId: 'pricing' },
  { label: 'FAQ', targetId: 'faq' },
];

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isCompact, setIsCompact] = useState(false);
  const appUrl = normalizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);

  const toggleMobileMenu = () => {
    setMobileMenuOpen(!mobileMenuOpen);
  };

  const handleSmoothScroll = (e: React.MouseEvent<HTMLAnchorElement>, targetId: string) => {
    e.preventDefault();
    const element = document.getElementById(targetId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
      setMobileMenuOpen(false);
    }
  };

  useEffect(() => {
    const onScroll = () => {
      setIsCompact(window.scrollY > 24);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 z-50">
      <nav
        className={`mobile-blur-off mx-auto mt-2 sm:mt-3 flex items-center justify-between bg-white/50 shadow-lg shadow-slate-200/30 backdrop-blur-xl transition-all duration-300 ${
          isCompact ? 'max-w-5xl rounded-full px-6 py-4' : 'max-w-7xl rounded-3xl px-8 py-4'
        }`}
        aria-label="Main navigation"
      >
        <Link href="/" className="flex items-center transition-all duration-300">
          <img
            src="https://res.cloudinary.com/dnpvndlmy/image/upload/v1770689074/marquill/logo_bpw55v.svg"
            alt="Marquill"
            className={`transition-all duration-300 ${isCompact ? 'h-7' : 'h-9'} w-auto`}
            width={36}
            height={36}
          />
        </Link>

        <div className={`hidden md:flex items-center transition-all duration-300 ${isCompact ? 'gap-6' : 'gap-8'}`}>
          {navItems.map((item) => (
            <a
              key={item.targetId}
              href={`#${item.targetId}`}
              onClick={(e) => handleSmoothScroll(e, item.targetId)}
              className="text-sm font-medium text-text-secondary hover:text-text-primary transition-colors"
            >
              {item.label}
            </a>
          ))}
        </div>

        <div className={`hidden md:flex items-center transition-all duration-300 ${isCompact ? 'gap-2' : 'gap-3'}`}>
          <label className="sr-only" htmlFor="desktop-language-selector">
            Language
          </label>
          <select
            id="desktop-language-selector"
            aria-label="Language selector"
            defaultValue="en"
            className={`rounded-full border border-slate-200 bg-white px-3 text-sm font-semibold text-text-secondary outline-none transition-colors hover:text-text-primary ${
              isCompact ? 'py-1.5' : 'py-2'
            }`}
          >
            <option value="en">English (EN)</option>
          </select>
          <a
            href={appUrl}
            className={`text-sm font-semibold text-white rounded-full bg-gradient-to-r from-[#5B5CF6] via-[#6C62FF] to-[#7C72FF] shadow-lg shadow-indigo-200 hover:shadow-indigo-300 transition-all ${
              isCompact ? 'px-4 py-2' : 'px-5 py-2.5'
            }`}
            aria-label="Get started now"
          >
            Get started now &rarr;
          </a>
        </div>

        <div className="md:hidden">
          <button
            onClick={toggleMobileMenu}
            className={`inline-flex items-center justify-center rounded-full text-text-secondary hover:text-text-primary hover:bg-white/70 transition-all duration-300 ${
              isCompact ? 'p-2' : 'p-3'
            }`}
            aria-expanded={mobileMenuOpen}
            aria-label="Toggle navigation menu"
            aria-controls="mobile-menu"
          >
            {mobileMenuOpen ? (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </nav>

      {mobileMenuOpen && (
        <div id="mobile-menu" className="md:hidden px-4 sm:px-6 pt-3">
          <div className="flex flex-col gap-4 rounded-2xl bg-white/90 p-4 shadow-lg backdrop-blur-xl">
            {navItems.map((item) => (
              <a
                key={item.targetId}
                href={`#${item.targetId}`}
                onClick={(e) => handleSmoothScroll(e, item.targetId)}
                className="text-base font-medium text-text-secondary hover:text-text-primary transition-colors"
              >
                {item.label}
              </a>
            ))}
            <label className="sr-only" htmlFor="mobile-language-selector">
              Language
            </label>
            <select
              id="mobile-language-selector"
              aria-label="Language selector"
              defaultValue="en"
              className="w-full rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-text-secondary outline-none"
            >
              <option value="en">English (EN)</option>
            </select>
            <a
              href={appUrl}
              className="w-full rounded-full bg-gradient-to-r from-[#5B5CF6] via-[#6C62FF] to-[#7C72FF] px-4 py-2 text-sm font-semibold text-white shadow-lg"
              aria-label="Get started now"
            >
              Get started now &rarr;
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
