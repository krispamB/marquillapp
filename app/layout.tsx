import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { ClerkProvider } from "@clerk/nextjs";
import { Courier_Prime, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter-raw",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono-raw",
  display: "swap",
});

const courierPrime = Courier_Prime({
  subsets: ["latin"],
  variable: "--font-courier-prime-raw",
  weight: ["400", "700"],
  display: "swap",
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
    <ClerkProvider>
      <html
        lang="en"
        suppressHydrationWarning
        className={`${inter.variable} ${jetbrainsMono.variable} ${courierPrime.variable}`}
      >
        <head>
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(){try{var t=localStorage.getItem('marquill-theme');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t}catch(e){}})()`,
            }}
          />
        </head>
        <body suppressHydrationWarning className="antialiased">
          {children}
          <Analytics />
        </body>
      </html>
    </ClerkProvider>
  );
}
