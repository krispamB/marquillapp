import { Check } from 'lucide-react';

export const metadata = {
    title: 'Pricing — Plans for Every LinkedIn Creator',
    description:
        'Choose a Marquill plan. From free to Pro — get AI post generation, multi-account LinkedIn management, and scheduling that fits your publishing volume.',
    alternates: {
        canonical: 'https://marquill.com/pricing',
    },
    openGraph: {
        title: 'Marquill Pricing — AI LinkedIn Workspace Plans',
        description: 'Free, Starter, Creator, and Pro plans. Start your AI LinkedIn workspace today.',
        url: 'https://marquill.com/pricing',
    },
};

interface PricingTier {
    name: string;
    price: string;
    period: string;
    description: string;
    features: string[];
    highlighted?: boolean;
    cta: string;
}

const pricingTiers: PricingTier[] = [
    {
        name: 'Free',
        price: '$0',
        period: '',
        description: 'Get started with core creation and publishing.',
        features: [
            '1 LinkedIn account',
            '5 AI posts / month',
            '3 scheduled posts queued',
            '30 days post history',
        ],
        cta: 'Get started',
    },
    {
        name: 'Starter',
        price: '$9.99',
        period: '/month',
        description: 'For consistent weekly posting.',
        features: [
            '1 LinkedIn account',
            '30 AI posts / month',
            '10 scheduled posts queued',
            '90 days post history',
        ],
        cta: 'Start free trial',
    },
    {
        name: 'Creator',
        price: '$19.99',
        period: '/month',
        description: 'Best for creators scaling output.',
        features: [
            '2 LinkedIn accounts',
            '100 AI posts / month',
            '50 scheduled posts queued',
            '1 year post history',
        ],
        highlighted: true,
        cta: 'Start free trial',
    },
    {
        name: 'Pro Writer',
        price: '$29.99',
        period: '/month',
        description: 'High-volume teams and agencies.',
        features: [
            '10 LinkedIn accounts',
            'Unlimited AI posts',
            'Unlimited scheduled posts',
            'Unlimited post history',
        ],
        cta: 'Start free trial',
    },
];

const faqs = [
    {
        q: 'Can I change plans later?',
        a: "Yes! You can upgrade or downgrade your plan at any time. Changes take effect immediately, and we'll prorate any charges.",
    },
    {
        q: 'What happens after the free trial?',
        a: "After your 14-day free trial, you'll be charged for your selected plan. You can cancel anytime during the trial with no charges.",
    },
    {
        q: 'Do you offer refunds?',
        a: "Yes, we offer a 30-day money-back guarantee. If you're not satisfied with Marquill, contact us for a full refund.",
    },
    {
        q: 'Is there a discount for annual billing?',
        a: 'Yes! Save 20% when you choose annual billing. Contact our sales team for more information.',
    },
];

export default function PricingPage() {
    return (
        <div className="bg-surface">
            {/* Hero */}
            <section className="border-b border-line bg-surface px-5 py-16 text-center sm:px-6 sm:py-20 lg:px-8">
                <span className="ff-mono text-[12px] text-ink-400">_ pricing</span>
                <h1 className="mx-auto mt-3 max-w-[760px] text-[34px] font-bold leading-[1.04] tracking-[-0.035em] text-ink-900 text-balance sm:text-[48px]">
                    Choose the plan that fits your workflow
                </h1>
                <p className="mx-auto mt-4 max-w-2xl text-[17px] leading-[1.5] text-ink-500 sm:text-[19px]">
                    Choose the plan that fits your LinkedIn output. Every plan includes a 14-day free trial.
                </p>
            </section>

            {/* Pricing cards */}
            <section className="bg-canvas px-5 py-16 sm:px-6 sm:py-20 lg:px-8">
                <div className="mx-auto grid max-w-[1100px] items-start gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {pricingTiers.map((tier) => (
                        <div
                            key={tier.name}
                            className={`flex flex-col gap-4 rounded-[16px] border bg-surface p-6 shadow-sm ${
                                tier.highlighted ? 'border-accent ring-1 ring-accent/30' : 'border-line'
                            }`}
                        >
                            <div className="flex min-h-6 items-center justify-between">
                                <span className="text-[15px] font-semibold text-ink-900">{tier.name}</span>
                                {tier.highlighted && (
                                    <span className="rounded-full bg-accent px-2.5 py-1 text-[11px] font-semibold text-white">
                                        Most popular
                                    </span>
                                )}
                            </div>

                            <div className="flex items-baseline gap-1">
                                <span className="text-[36px] font-bold tabular-nums tracking-[-0.03em] text-ink-900">
                                    {tier.price}
                                </span>
                                {tier.period && <span className="text-[14px] text-ink-500">{tier.period}</span>}
                            </div>

                            <p className="min-h-[38px] text-[13.5px] leading-[1.45] text-ink-500">{tier.description}</p>

                            <button
                                className="inline-flex min-h-11 items-center justify-center rounded-[10px] bg-ink-900 px-5 text-[14px] font-semibold tracking-[-0.01em] text-surface transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                                aria-label={`${tier.cta} for ${tier.name} plan`}
                            >
                                {tier.cta}
                            </button>

                            <ul className="flex flex-col gap-2.5 border-t border-line-faint pt-2">
                                {tier.features.map((feature) => (
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
                        Frequently asked questions
                    </h2>
                    <div className="mt-10 space-y-8">
                        {faqs.map((faq) => (
                            <div key={faq.q}>
                                <h3 className="text-[18px] font-semibold text-ink-900">{faq.q}</h3>
                                <p className="mt-2 text-[15px] leading-[1.6] text-ink-500">{faq.a}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* CTA */}
            <section className="bg-canvas px-5 py-16 text-center sm:px-6 sm:py-20 lg:px-8">
                <h2 className="mx-auto max-w-[640px] text-[28px] font-bold leading-[1.06] tracking-[-0.03em] sm:text-[34px]">
                    <span className="text-ink-900">Get started for free.</span>{' '}
                    <span className="text-ink-500">Start your trial today.</span>
                </h2>
                <p className="mx-auto mt-4 max-w-xl text-[16px] text-ink-500">
                    14-day free trial. No credit card required.
                </p>
                <a
                    href="/checkout"
                    className="mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-[10px] bg-ink-900 px-[26px] text-[15px] font-semibold tracking-[-0.01em] text-surface transition-opacity hover:opacity-90"
                >
                    Start free trial →
                </a>
            </section>
        </div>
    );
}
