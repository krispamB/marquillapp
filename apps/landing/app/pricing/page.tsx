import { Check } from 'lucide-react';
import { plans, faqs } from '@/components/landing/data';
import { normalizeAppUrl } from '@/config/urls';

export const metadata = {
    title: 'Pricing — Marquill',
    description:
        'Four plans, priced by AI credits, connected accounts, and how far back your post history goes. Start on the free plan, no card needed.',
    alternates: {
        canonical: 'https://marquill.com/pricing',
    },
    openGraph: {
        title: 'Marquill Pricing — AI LinkedIn Workspace Plans',
        description: 'Four plans, priced by AI credits, connected accounts, and post history.',
        url: 'https://marquill.com/pricing',
    },
};

export default function PricingPage() {
    const appUrl = normalizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);

    return (
        <div className="bg-surface">
            {/* Hero */}
            <section className="border-b border-line bg-surface px-5 py-16 text-center sm:px-6 sm:py-20 lg:px-8">
                <span className="ff-mono text-[12px] text-ink-400">_ pricing</span>
                <h1 className="mx-auto mt-3 max-w-[760px] text-[34px] font-bold leading-[1.04] tracking-[-0.035em] text-ink-900 text-balance sm:text-[48px]">
                    Pay for the volume you post.
                </h1>
                <p className="mx-auto mt-4 max-w-2xl text-[17px] leading-[1.5] text-ink-500 sm:text-[19px]">
                    Credits, connected accounts, and post history. That is all that changes between plans.
                </p>
            </section>

            {/* Pricing cards */}
            <section className="bg-canvas px-5 py-16 sm:px-6 sm:py-20 lg:px-8">
                <div className="mx-auto grid max-w-[1100px] items-start gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {plans.map((plan) => (
                        <div
                            key={plan.name}
                            className={`flex flex-col gap-4 rounded-[16px] border bg-surface p-6 shadow-sm ${
                                plan.popular ? 'border-accent ring-1 ring-accent/30' : 'border-line'
                            }`}
                        >
                            <div className="flex min-h-6 items-center justify-between">
                                <span className="text-[15px] font-semibold text-ink-900">{plan.name}</span>
                                {plan.popular && (
                                    <span className="rounded-full bg-accent px-2.5 py-1 text-[11px] font-semibold text-white">
                                        Most popular
                                    </span>
                                )}
                            </div>

                            <div className="flex items-baseline gap-1">
                                <span className="text-[36px] font-bold tabular-nums tracking-[-0.03em] text-ink-900">
                                    {plan.price}
                                </span>
                                {plan.period && <span className="text-[14px] text-ink-500">{plan.period}</span>}
                            </div>

                            <p className="min-h-[38px] text-[13.5px] leading-[1.45] text-ink-500">{plan.blurb}</p>

                            <a
                                href={appUrl}
                                className="inline-flex min-h-11 items-center justify-center rounded-[10px] bg-ink-900 px-5 text-[14px] font-semibold tracking-[-0.01em] text-surface transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                                aria-label={`${plan.cta} for ${plan.name} plan`}
                            >
                                {plan.cta}
                            </a>

                            <ul className="flex flex-col gap-2.5 border-t border-line-faint pt-2">
                                {plan.features.map((feature) => (
                                    <li key={feature} className="flex items-center gap-2.5 text-[13.5px] text-ink-700">
                                        <Check className="h-[15px] w-[15px] flex-none text-accent" strokeWidth={2.4} />
                                        {feature}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </section>

            {/* FAQ */}
            <section className="border-t border-line bg-surface px-5 py-16 sm:px-6 sm:py-20 lg:px-8">
                <div className="mx-auto max-w-3xl">
                    <h2 className="text-center text-[28px] font-bold tracking-[-0.03em] text-ink-900 sm:text-[34px]">
                        Questions before you start
                    </h2>
                    <dl className="mt-10 space-y-8">
                        {faqs.map((faq) => (
                            <div key={faq.q}>
                                <dt className="text-[18px] font-semibold text-ink-900">{faq.q}</dt>
                                <dd className="mt-2 text-[15px] leading-[1.6] text-ink-500">{faq.a}</dd>
                            </div>
                        ))}
                    </dl>
                </div>
            </section>

            {/* CTA */}
            <section className="bg-canvas px-5 py-16 text-center sm:px-6 sm:py-20 lg:px-8">
                <h2 className="mx-auto max-w-[640px] text-[28px] font-bold leading-[1.06] tracking-[-0.03em] sm:text-[34px]">
                    <span className="text-ink-900">Give Mark a topic.</span>{' '}
                    <span className="text-ink-500">Read the draft before you decide.</span>
                </h2>
                <p className="mx-auto mt-4 max-w-xl text-[16px] text-ink-500">
                    The free plan has no card and no time limit.
                </p>
                <a
                    href={appUrl}
                    className="mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-[10px] bg-ink-900 px-[26px] text-[15px] font-semibold tracking-[-0.01em] text-surface transition-opacity hover:opacity-90"
                >
                    Get started for free →
                </a>
            </section>
        </div>
    );
}
