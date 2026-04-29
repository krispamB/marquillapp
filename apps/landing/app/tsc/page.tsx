import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description:
    'Terms of Service for Marquill — the AI LinkedIn workspace. Read our terms before using the platform.',
  alternates: {
    canonical: 'https://marquill.com/tsc',
  },
};

export default function TermsOfServicePage() {
  return (
    <article className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 pb-16">
        <h1 className="text-4xl font-bold text-text-primary mb-4">Terms of Service</h1>
        <p className="text-sm text-text-secondary mb-12">Last Updated: 29 April 2026</p>

        <div className="prose prose-lg max-w-none">

          <section className="mb-12" aria-labelledby="intro-heading">
            <h2 id="intro-heading" className="text-2xl font-semibold text-text-primary mb-4">1. Introduction</h2>
            <p className="text-text-secondary leading-relaxed mb-4">
              These Terms of Service govern your use of Marquill (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;) and the services available at marquill.com. By accessing or using Marquill, you agree to be bound by these terms.
            </p>
            <p className="text-text-secondary leading-relaxed">
              If you do not agree to these terms, please do not use the platform.
            </p>
          </section>

          <section className="mb-12" aria-labelledby="use-heading">
            <h2 id="use-heading" className="text-2xl font-semibold text-text-primary mb-4">2. Use of Service</h2>
            <p className="text-text-secondary leading-relaxed mb-4">
              You must be at least 18 years old to use Marquill. By using our service, you confirm that you meet this requirement.
            </p>
            <ul className="list-disc pl-6 mb-4 text-text-secondary space-y-2">
              <li>You are responsible for maintaining the security of your account credentials.</li>
              <li>You may not use Marquill for any unlawful purpose or in violation of LinkedIn&apos;s terms of service.</li>
              <li>You may not attempt to reverse-engineer, scrape, or abuse the platform&apos;s infrastructure.</li>
              <li>One account per user unless explicitly authorised under a team or agency plan.</li>
              <li>
                Marquill uses YouTube API Services. By using Marquill, you also agree to be bound by the{' '}
                <a
                  href="https://www.youtube.com/t/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#5B5CF6] underline hover:text-[#4a4bc4]"
                >
                  YouTube Terms of Service
                </a>
                .
              </li>
            </ul>
          </section>

          <section className="mb-12" aria-labelledby="ip-heading">
            <h2 id="ip-heading" className="text-2xl font-semibold text-text-primary mb-4">3. Intellectual Property</h2>
            <p className="text-text-secondary leading-relaxed mb-4">
              Marquill and its underlying technology, design, and branding are owned by us and protected by applicable intellectual property laws.
            </p>
            <p className="text-text-secondary leading-relaxed">
              Content you create using Marquill remains your property. We do not claim ownership over posts, drafts, or materials you generate through the platform.
            </p>
          </section>

          <section className="mb-12" aria-labelledby="disclaimer-heading">
            <h2 id="disclaimer-heading" className="text-2xl font-semibold text-text-primary mb-4">4. Disclaimer of Warranties</h2>
            <p className="text-text-secondary leading-relaxed mb-4">
              Marquill is provided &quot;as is&quot; without warranties of any kind, express or implied. We do not guarantee uninterrupted access, error-free operation, or specific outcomes from using our AI features.
            </p>
            <p className="text-text-secondary leading-relaxed">
              Use of AI-generated content is at your own discretion. You are responsible for reviewing and editing any content before publishing.
            </p>
          </section>

          <section className="mb-12" aria-labelledby="liability-heading">
            <h2 id="liability-heading" className="text-2xl font-semibold text-text-primary mb-4">5. Limitation of Liability</h2>
            <p className="text-text-secondary leading-relaxed">
              To the fullest extent permitted by law, Marquill shall not be liable for any indirect, incidental, consequential, or punitive damages arising from your use of the platform, including but not limited to loss of data, revenue, or reputation.
            </p>
          </section>

          <section className="mb-12" aria-labelledby="termination-heading">
            <h2 id="termination-heading" className="text-2xl font-semibold text-text-primary mb-4">6. Termination</h2>
            <p className="text-text-secondary leading-relaxed">
              We reserve the right to suspend or terminate your account at any time if we determine, in our sole discretion, that you have violated these terms or engaged in conduct harmful to other users or the platform.
            </p>
          </section>

          <section className="mb-12" aria-labelledby="changes-heading">
            <h2 id="changes-heading" className="text-2xl font-semibold text-text-primary mb-4">7. Changes to These Terms</h2>
            <p className="text-text-secondary leading-relaxed">
              We may update these Terms of Service from time to time. Changes will be posted on this page with a revised &quot;Last Updated&quot; date. Continued use of Marquill after changes are posted constitutes your acceptance of the updated terms.
            </p>
          </section>

          <section className="mb-12" aria-labelledby="contact-heading">
            <h2 id="contact-heading" className="text-2xl font-semibold text-text-primary mb-4">8. Contact</h2>
            <p className="text-text-secondary leading-relaxed mb-4">
              If you have any questions about these terms, please contact us at:
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
