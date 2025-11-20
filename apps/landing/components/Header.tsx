'use client';

import { useState } from 'react';
import Logo from './Logo';
import Link from 'next/link';

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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

  return (
    <header className="sticky top-0 z-50 bg-white shadow-sm">
      <nav className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8" aria-label="Main navigation">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <div className="flex-shrink-0">
            <Link href="/">
              <Logo width={140} height={36} />
            </Link>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex md:items-center md:space-x-8">
            <a
              href="#features"
              onClick={(e) => handleSmoothScroll(e, 'features')}
              className="text-text-secondary hover:text-primary transition-colors duration-200 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded px-2 py-1"
            >
              Features
            </a>
            <Link
              href="/pricing"
              className="text-text-secondary hover:text-primary transition-colors duration-200 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded px-2 py-1"
            >
              Pricing
            </Link>
            <div className="flex items-center space-x-3">
              <button
                className="text-text-secondary hover:text-primary px-4 py-2 rounded-lg font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                aria-label="Login to inContentai"
              >
                Login
              </button>
              <button
                className="bg-primary text-white px-6 py-3 rounded-lg font-semibold hover:opacity-90 transition-all duration-200 shadow-sm hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                aria-label="Get started with inContentai"
              >
                Get Started
              </button>
            </div>
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden">
            <button
              onClick={toggleMobileMenu}
              className="inline-flex items-center justify-center p-3 rounded-md text-text-secondary hover:text-primary hover:bg-surface transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 min-h-[44px] min-w-[44px]"
              aria-expanded={mobileMenuOpen}
              aria-label="Toggle navigation menu"
              aria-controls="mobile-menu"
            >
              {mobileMenuOpen ? (
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth="2"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth="2"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile Navigation Menu */}
        {mobileMenuOpen && (
          <div id="mobile-menu" className="md:hidden border-t border-gray-200">
            <div className="space-y-1 px-2 pb-3 pt-2">
              <a
                href="#features"
                onClick={(e) => handleSmoothScroll(e, 'features')}
                className="block px-3 py-3 rounded-md text-base font-medium text-text-secondary hover:text-primary hover:bg-surface transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset min-h-[44px]"
              >
                Features
              </a>
              <Link
                href="/pricing"
                className="block px-3 py-3 rounded-md text-base font-medium text-text-secondary hover:text-primary hover:bg-surface transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset min-h-[44px]"
                onClick={() => setMobileMenuOpen(false)}
              >
                Pricing
              </Link>
              <div className="space-y-2 mt-2">
                <button
                  className="w-full text-text-secondary hover:text-primary px-6 py-3 rounded-lg font-semibold border border-gray-300 hover:border-primary transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 min-h-[44px]"
                  aria-label="Login to inContentai"
                >
                  Login
                </button>
                <button
                  className="w-full bg-primary text-white px-6 py-3 rounded-lg font-semibold hover:opacity-90 transition-all duration-200 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 min-h-[44px]"
                  aria-label="Get started with inContentai"
                >
                  Get Started
                </button>
              </div>
            </div>
          </div>
        )}
      </nav>
    </header>
  );
}
