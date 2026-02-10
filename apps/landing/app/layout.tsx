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
  title: 'Marquill',
  description: 'Marquill helps teams transform viral formats into winning scripts and scalable content.',
  openGraph: {
    title: 'Marquill',
    description: 'Transform viral formats into winning scripts with Marquill.',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Marquill',
    description: 'Transform viral formats into winning scripts with Marquill.',
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
