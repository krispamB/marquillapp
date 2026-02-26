import type { Metadata } from "next";
import { Sora, Sofia_Sans } from "next/font/google";
import "./globals.css";

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
});

const sofiaSans = Sofia_Sans({
  variable: "--font-sofia-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: 'Marquill - AI-Powered LinkedIn Content Platform',
  description:
    'Marquill helps LinkedIn creators generate posts from YouTube research, schedule content, and publish faster.',
  keywords: 'LinkedIn content, AI post generator, YouTube research, scheduling, publishing',
  openGraph: {
    title: 'Marquill - AI-Powered LinkedIn Content Platform',
    description: 'Generate LinkedIn posts from YouTube research, schedule, and publish in one place.',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Marquill - AI-Powered LinkedIn Content Platform',
    description: 'Generate LinkedIn posts from YouTube research, schedule, and publish in one place.',
  },
};;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${sora.variable} ${sofiaSans.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
