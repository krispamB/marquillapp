import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

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
    <ClerkProvider>
      <html lang="en">
        <body suppressHydrationWarning className="antialiased">
          {children}
          <Analytics />
        </body>
      </html>
    </ClerkProvider>
  );
}
