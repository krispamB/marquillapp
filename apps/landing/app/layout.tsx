import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'inContentai for LinkedIn',
  description: 'AI-powered LinkedIn content—researched, written, and ready to post.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
