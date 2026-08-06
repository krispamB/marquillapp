import Hero from '@/components/landing/Hero';
import MadeWithMark from '@/components/landing/MadeWithMark';
import WhatMarkMakes from '@/components/landing/WhatMarkMakes';
import OneWorkspace from '@/components/landing/OneWorkspace';
import Spotlight from '@/components/landing/Spotlight';
import Pricing from '@/components/landing/Pricing';
import ClosingCta from '@/components/landing/ClosingCta';
import { normalizeAppUrl } from '@/config/urls';

export const metadata = {
  title: 'Marquill — Meet Mark, your LinkedIn agent',
  description:
    'Just tell Mark what to post. He writes it, designs the carousel, builds the poll, and ships it — in your voice, across every account. Marquill is your AI LinkedIn workspace.',
  keywords:
    'AI LinkedIn agent, AI LinkedIn workspace, LinkedIn post generator, LinkedIn carousels, LinkedIn polls, content scheduling, personal branding',
  alternates: {
    canonical: 'https://marquill.com',
  },
  openGraph: {
    title: 'Marquill — Meet Mark, your LinkedIn agent',
    description: 'Just tell Mark what to post. He writes it, designs it, and ships it.',
    type: 'website',
    locale: 'en_US',
    url: 'https://marquill.com',
    images: [{ url: '/og-image.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Marquill — Meet Mark, your LinkedIn agent',
    description: 'Just tell Mark what to post. He writes it, designs it, and ships it.',
    images: ['/og-image.png'],
  },
};

export default function Home() {
  const appUrl = normalizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        name: 'Marquill',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        description:
          'Marquill is an AI LinkedIn workspace. Mark, the LinkedIn agent, drafts posts, designs carousels, builds polls, and schedules publishing across every account.',
        url: 'https://marquill.com',
        offers: [
          { '@type': 'Offer', price: '0', priceCurrency: 'USD', name: 'Free Plan' },
          { '@type': 'Offer', price: '9.99', priceCurrency: 'USD', name: 'Starter Plan' },
          { '@type': 'Offer', price: '19.99', priceCurrency: 'USD', name: 'Creator Plan' },
          { '@type': 'Offer', price: '29.99', priceCurrency: 'USD', name: 'Pro Writer Plan' },
        ],
      },
      {
        '@type': 'Organization',
        name: 'Marquill',
        url: 'https://marquill.com',
        logo: 'https://marquill.com/logo.svg',
        contactPoint: {
          '@type': 'ContactPoint',
          email: 'hello@marquill.com',
          contactType: 'customer support',
        },
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Hero />
      <MadeWithMark />
      <WhatMarkMakes />
      <OneWorkspace />
      <Spotlight />
      <Pricing appUrl={appUrl} />
      <ClosingCta appUrl={appUrl} />
    </>
  );
}
