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
        cta: 'Start Free Trial',
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
        cta: 'Start Free Trial',
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
        cta: 'Start Free Trial',
    },
];

export default function PricingPage() {
    return (
        <div className="bg-white">
            {/* Hero Section */}
            <section className="py-16 sm:py-20 bg-gradient-to-b from-white to-surface">
                <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                    <div className="text-center">
                        <h1 className="text-4xl sm:text-5xl font-bold text-text-primary mb-6">
                            Simple, Transparent Pricing
                        </h1>
                        <p className="text-xl text-text-secondary max-w-2xl mx-auto">
                            Choose the plan that fits your LinkedIn content creation needs. All plans include a 14-day free trial.
                        </p>
                    </div>
                </div>
            </section>

            {/* Pricing Cards */}
            <section className="py-16 sm:py-20">
                <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                        {pricingTiers.map((tier, index) => (
                            <div
                                key={index}
                                className={`rounded-2xl p-8 ${tier.highlighted
                                    ? 'bg-primary text-white shadow-2xl scale-105 border-2 border-primary'
                                    : 'bg-white border-2 border-gray-200 shadow-lg'
                                    }`}
                            >
                                {tier.highlighted && (
                                    <div className="text-center mb-4">
                                        <span className="inline-block bg-white text-primary px-4 py-1 rounded-full text-sm font-semibold">
                                            Most Popular
                                        </span>
                                    </div>
                                )}

                                <div className="text-center mb-6">
                                    <h2
                                        className={`text-2xl font-bold mb-2 ${tier.highlighted ? 'text-white' : 'text-text-primary'
                                            }`}
                                    >
                                        {tier.name}
                                    </h2>
                                    <div className="flex items-baseline justify-center mb-2">
                                        <span
                                            className={`text-5xl font-bold ${tier.highlighted ? 'text-white' : 'text-text-primary'
                                                }`}
                                        >
                                            {tier.price}
                                        </span>
                                        <span
                                            className={`text-xl ml-2 ${tier.highlighted ? 'text-white/80' : 'text-text-secondary'
                                                }`}
                                        >
                                            {tier.period}
                                        </span>
                                    </div>
                                    <p
                                        className={`text-sm ${tier.highlighted ? 'text-white/90' : 'text-text-secondary'
                                            }`}
                                    >
                                        {tier.description}
                                    </p>
                                </div>

                                <ul className="space-y-4 mb-8">
                                    {tier.features.map((feature, featureIndex) => (
                                        <li key={featureIndex} className="flex items-start">
                                            <Check
                                                className={`w-5 h-5 mr-3 flex-shrink-0 mt-0.5 ${tier.highlighted ? 'text-white' : 'text-primary'
                                                    }`}
                                            />
                                            <span
                                                className={`text-sm ${tier.highlighted ? 'text-white' : 'text-text-secondary'
                                                    }`}
                                            >
                                                {feature}
                                            </span>
                                        </li>
                                    ))}
                                </ul>

                                <button
                                    className={`w-full py-3 px-6 rounded-lg font-semibold transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 min-h-[44px] ${tier.highlighted
                                        ? 'bg-white text-primary hover:bg-gray-50 focus-visible:ring-white'
                                        : 'bg-primary text-white hover:opacity-90 focus-visible:ring-primary'
                                        }`}
                                    aria-label={`${tier.cta} for ${tier.name} plan`}
                                >
                                    {tier.cta}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* FAQ Section */}
            <section className="py-16 sm:py-20 bg-surface">
                <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
                    <h2 className="text-3xl font-bold text-text-primary text-center mb-12">
                        Frequently Asked Questions
                    </h2>
                    <div className="space-y-8">
                        <div>
                            <h3 className="text-xl font-semibold text-text-primary mb-2">
                                Can I change plans later?
                            </h3>
                            <p className="text-text-secondary">
                                Yes! You can upgrade or downgrade your plan at any time. Changes take effect immediately, and we&apos;ll prorate any charges.
                            </p>
                        </div>
                        <div>
                            <h3 className="text-xl font-semibold text-text-primary mb-2">
                                What happens after the free trial?
                            </h3>
                            <p className="text-text-secondary">
                                After your 14-day free trial, you&apos;ll be charged for your selected plan. You can cancel anytime during the trial with no charges.
                            </p>
                        </div>
                        <div>
                            <h3 className="text-xl font-semibold text-text-primary mb-2">
                                Do you offer refunds?
                            </h3>
                            <p className="text-text-secondary">
                                Yes, we offer a 30-day money-back guarantee. If you&apos;re not satisfied with Marquill, contact us for a full refund.
                            </p>
                        </div>
                        <div>
                            <h3 className="text-xl font-semibold text-text-primary mb-2">
                                Is there a discount for annual billing?
                            </h3>
                            <p className="text-text-secondary">
                                Yes! Save 20% when you choose annual billing. Contact our sales team for more information.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* CTA Section */}
            <section className="py-16 sm:py-20 bg-gradient-to-br from-primary to-primary/90">
                <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 text-center">
                    <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6">
                        Ready to Get Started?
                    </h2>
                    <p className="text-xl text-white/90 mb-8">
                        Start your 14-day free trial today. No credit card required.
                    </p>
                    <button
                        className="bg-white text-primary px-8 py-4 rounded-lg font-semibold text-lg hover:bg-gray-50 transition-all duration-200 shadow-lg hover:shadow-xl hover:scale-105 inline-flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-primary min-h-[44px]"
                        aria-label="Start your free trial"
                    >
                        Start Free Trial
                        <svg
                            className="w-5 h-5"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth="2"
                            stroke="currentColor"
                            aria-hidden="true"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                        </svg>
                    </button>
                </div>
            </section>
        </div>
    );
}
