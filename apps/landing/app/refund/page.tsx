import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Refund Policy',
  description:
    'Refund Policy for Marquill — learn about our 30-day money-back guarantee and how to request a refund.',
  alternates: {
    canonical: 'https://marquill.com/refund',
  },
};

export default function RefundPolicyPage() {
  return (
    <article className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 pb-16">
        <h1 className="text-4xl font-bold text-text-primary mb-4">Refund Policy</h1>
        <p className="text-sm text-text-secondary mb-12">Last Updated: 12 April 2026</p>

        <div className="prose prose-lg max-w-none">

          <section className="mb-12" aria-labelledby="overview-heading">
            <h2 id="overview-heading" className="text-2xl font-semibold text-text-primary mb-4">1. Overview</h2>
            <p className="text-text-secondary leading-relaxed">
              We stand behind Marquill. If you&apos;re not satisfied with your paid plan, we offer a <strong>30-day money-back guarantee</strong> on all first-time subscriptions. No lengthy process — just reach out and we&apos;ll take care of it.
            </p>
          </section>

          <section className="mb-12" aria-labelledby="eligibility-heading">
            <h2 id="eligibility-heading" className="text-2xl font-semibold text-text-primary mb-4">2. Eligibility</h2>
            <p className="text-text-secondary leading-relaxed mb-4">
              To be eligible for a refund, the following conditions must be met:
            </p>
            <ul className="list-disc pl-6 mb-4 text-text-secondary space-y-2">
              <li>You are a first-time subscriber to a paid Marquill plan.</li>
              <li>Your refund request is submitted within 30 days of the original charge date.</li>
              <li>Your account has not been terminated for violating our Terms of Service.</li>
            </ul>
          </section>

          <section className="mb-12" aria-labelledby="how-to-heading">
            <h2 id="how-to-heading" className="text-2xl font-semibold text-text-primary mb-4">3. How to Request a Refund</h2>
            <p className="text-text-secondary leading-relaxed mb-4">
              Send an email to <strong>hello@marquill.com</strong> with the subject line <strong>&quot;Refund Request&quot;</strong>. Please include:
            </p>
            <ul className="list-disc pl-6 mb-4 text-text-secondary space-y-2">
              <li>The email address associated with your Marquill account.</li>
              <li>The date of the charge you are requesting a refund for.</li>
              <li>A brief reason for your request (optional, but appreciated).</li>
            </ul>
          </section>

          <section className="mb-12" aria-labelledby="processing-heading">
            <h2 id="processing-heading" className="text-2xl font-semibold text-text-primary mb-4">4. Processing Time</h2>
            <p className="text-text-secondary leading-relaxed">
              Once your request is approved, refunds are processed within <strong>5–10 business days</strong> to the original payment method. You will receive a confirmation email when the refund has been issued.
            </p>
          </section>

          <section className="mb-12" aria-labelledby="non-refundable-heading">
            <h2 id="non-refundable-heading" className="text-2xl font-semibold text-text-primary mb-4">5. Non-Refundable Cases</h2>
            <p className="text-text-secondary leading-relaxed mb-4">
              The following are not eligible for a refund:
            </p>
            <ul className="list-disc pl-6 mb-4 text-text-secondary space-y-2">
              <li>Free plan usage (no charge applies).</li>
              <li>Renewal charges after the initial 30-day window.</li>
              <li>Accounts suspended or terminated for Terms of Service violations.</li>
              <li>Partial months or unused credits on a downgraded plan.</li>
            </ul>
          </section>

          <section className="mb-12" aria-labelledby="refund-contact-heading">
            <h2 id="refund-contact-heading" className="text-2xl font-semibold text-text-primary mb-4">6. Contact</h2>
            <p className="text-text-secondary leading-relaxed mb-4">
              Questions about our refund policy? We&apos;re happy to help.
            </p>
            <div className="bg-surface p-6 rounded-lg mt-4">
              <p className="text-text-secondary">
                <strong>Email:</strong> hello@marquill.com
              </p>
            </div>
          </section>

        </div>
      </div>
    </article>
  );
}
