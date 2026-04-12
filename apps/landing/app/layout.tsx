import type { Metadata } from 'next';
import { Sofia_Sans, Sora } from 'next/font/google';
import './globals.css';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

const sofiaSans = Sofia_Sans({
  subsets: ['latin'],
  variable: '--font-sofia-sans',
  weight: ['300', '400', '500', '600', '700', '800'],
  display: 'swap',
});

const sora = Sora({
  subsets: ['latin'],
  variable: '--font-sora',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://marquill.com'),
  title: {
    default: 'Marquill — AI LinkedIn Workspace for Creators & Teams',
    template: '%s | Marquill',
  },
  description:
    'Marquill is your AI LinkedIn workspace. Generate posts, manage multiple accounts, schedule and publish — all in one focused workflow built for creators and teams.',
  openGraph: {
    title: 'Marquill — AI LinkedIn Workspace',
    description: 'Your AI LinkedIn workspace. Generate, schedule, and publish posts that perform.',
    type: 'website',
    locale: 'en_US',
    url: 'https://marquill.com',
    siteName: 'Marquill',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Marquill — AI LinkedIn Workspace',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Marquill — AI LinkedIn Workspace',
    description: 'Your AI LinkedIn workspace. Generate, schedule, and publish posts that perform.',
    images: ['/og-image.png'],
  },
  alternates: {
    canonical: 'https://marquill.com',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${sofiaSans.variable} ${sora.variable}`}>
      <body className="antialiased">
        <a href="#main-content" className="skip-to-content">
          Skip to main content
        </a>
        <Header />
        <main id="main-content">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
