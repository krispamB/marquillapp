import { Check } from 'lucide-react';

export const metadata = {
    title: 'Pricing - inContentai for LinkedIn',
    description: 'Choose the perfect plan for your LinkedIn content creation needs. Flexible pricing for professionals and teams.',
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
        name: 'Starter',
        price: '$29',
        period: '/month',
        description: 'Perfect for professionals getting started with LinkedIn content',
        features: [
            '10 AI-generated posts per month',
            'Basic research automation',
            'Post editing tools',
            'Email support',
            'Content calendar',
        ],
        cta: 'Start Free Trial',
    },
    {
        name: 'Professional',
        price: '$79',
        period: '/month',
        description: 'For active LinkedIn creators who post regularly',
        features: [
            '50 AI-generated posts per month',
            'Advanced research automation',
            'Priority post editing',
            'Topic suggestions',
            'Scheduling tools',
            'Priority email support',
            'Analytics dashboard',
        ],
        highlighted: true,
        cta: 'Start Free Trial',
    },
    {
        name: 'Business',
        price: '$199',
        period: '/month',
        description: 'For teams and businesses managing multiple LinkedIn accounts',
        features: [
            'Unlimited AI-generated posts',
            'Multi-account management',
            'Team collaboration tools',
            'Custom brand voice',
            'Advanced analytics',
            'API access',
            'Dedicated account manager',
            '24/7 priority support',
        ],
        cta: 'Contact Sales',
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
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
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
                                Yes, we offer a 30-day money-back guarantee. If you&apos;re not satisfied with inContentai, contact us for a full refund.
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
