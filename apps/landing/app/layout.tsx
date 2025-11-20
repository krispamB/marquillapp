import type { Metadata } from 'next';
import { Inria_Sans } from 'next/font/google';
import './globals.css';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

const inriaSans = Inria_Sans({
  subsets: ['latin'],
  variable: '--font-inria-sans',
  weight: ['300', '400', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'inContentai',
  description: 'AI powered LinkedIn content researched, written, and ready to post.',
  openGraph: {
    title: 'inContentai for LinkedIn',
    description: 'AI powered LinkedIn content researched, written, and ready to post.',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'inContentai for LinkedIn',
    description: 'AI powered LinkedIn content researched, written, and ready to post.',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inriaSans.variable}>
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
