'use client';

import Logo from './Logo';
import Link from 'next/link';

export default function Footer() {
  const currentYear = new Date().getFullYear();

  const handleSmoothScroll = (e: React.MouseEvent<HTMLAnchorElement>, targetId: string) => {
    e.preventDefault();
    const element = document.getElementById(targetId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <footer className="bg-surface border-t border-gray-200" role="contentinfo">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Logo and Tagline Column */}
          <div className="space-y-4">
            <Logo width={140} height={36} priority={false} />
            <p className="text-text-secondary text-sm max-w-xs">
              AI-powered LinkedIn content—researched, written, and ready to post
            </p>
          </div>

          {/* Navigation Links Column */}
          <div>
            <h3 className="text-text-primary font-semibold mb-4">Navigation</h3>
            <ul className="space-y-3">
              <li>
                <a
                  href="#features"
                  onClick={(e) => handleSmoothScroll(e, 'features')}
                  className="text-text-secondary hover:text-primary transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded inline-block"
                >
                  Features
                </a>
              </li>
              <li>
                <Link
                  href="/privacy-policy"
                  className="text-text-secondary hover:text-primary transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded inline-block"
                >
                  Privacy Policy
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal Column */}
          <div>
            <h3 className="text-text-primary font-semibold mb-4">Legal</h3>
            <ul className="space-y-3">
              <li>
                <Link
                  href="/privacy-policy"
                  className="text-primary font-medium hover:text-opacity-80 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded inline-block"
                >
                  Privacy Policy
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Copyright Notice */}
        <div className="mt-12 pt-8 border-t border-gray-300">
          <p className="text-center text-text-secondary text-sm">
            © {currentYear} inContentai. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
