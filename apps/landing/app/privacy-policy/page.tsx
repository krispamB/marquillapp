import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy | inContentai',
  description: 'Privacy Policy for inContentai - Learn how we collect, use, and protect your data when using our AI-powered LinkedIn content creation tool.',
};

export default function PrivacyPolicyPage() {
  return (
    <article className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h1 className="text-4xl font-bold text-text-primary mb-4">Privacy Policy</h1>
        <p className="text-sm text-text-secondary mb-12">Last Updated: 20 November 2025</p>

        <div className="prose prose-lg max-w-none">
          {/* Introduction */}
          <section className="mb-12" aria-labelledby="introduction-heading">
            <h2 id="introduction-heading" className="text-2xl font-semibold text-text-primary mb-4">1. Introduction</h2>
            <p className="text-text-secondary leading-relaxed mb-4">
              This Privacy Policy explains how inContentAi (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;) collects, uses, and protects information when users access or use our website, services, or integrations, including those powered by the LinkedIn API.
            </p>
            <p className="text-text-secondary leading-relaxed">
              We are currently in the development stage and may update this policy as our product evolves.
            </p>
          </section>

          {/* Information We Collect */}
          <section className="mb-12" aria-labelledby="information-collection-heading">
            <h2 id="information-collection-heading" className="text-2xl font-semibold text-text-primary mb-4">2. Information We Collect</h2>

            <h3 className="text-xl font-semibold text-text-primary mb-3 mt-6">2.1 Information Provided by Users</h3>
            <p className="text-text-secondary leading-relaxed mb-4">
              We may collect:
            </p>
            <ul className="list-disc pl-6 mb-4 text-text-secondary space-y-2">
              <li>Name</li>
              <li>Email address</li>
              <li>LinkedIn profile information (when a user connects their account)</li>
              <li>Any content submitted by users while interacting with our service</li>
            </ul>

            <h3 className="text-xl font-semibold text-text-primary mb-3 mt-6">2.2 Automatically Collected Information</h3>
            <p className="text-text-secondary leading-relaxed mb-4">
              When users interact with our platform, we may automatically collect:
            </p>
            <ul className="list-disc pl-6 mb-4 text-text-secondary space-y-2">
              <li>IP address</li>
              <li>Device information</li>
              <li>Browser type</li>
              <li>Usage logs</li>
            </ul>

            <h3 className="text-xl font-semibold text-text-primary mb-3 mt-6">2.3 Data from LinkedIn</h3>
            <p className="text-text-secondary leading-relaxed mb-4">
              If a user signs in with LinkedIn or allows access, we may receive:
            </p>
            <ul className="list-disc pl-6 mb-4 text-text-secondary space-y-2">
              <li>Basic profile details</li>
              <li>Email address</li>
              <li>Public posts</li>
              <li>Any other data the user explicitly authorizes through LinkedIn OAuth</li>
            </ul>
            <p className="text-text-secondary leading-relaxed mt-4">
              We only request permissions necessary to provide the service.
            </p>
          </section>

          {/* How We Use Collected Information */}
          <section className="mb-12" aria-labelledby="data-usage-heading">
            <h2 id="data-usage-heading" className="text-2xl font-semibold text-text-primary mb-4">3. How We Use Collected Information</h2>
            <p className="text-text-secondary leading-relaxed mb-4">
              We use collected data to:
            </p>
            <ul className="list-disc pl-6 mb-4 text-text-secondary space-y-2">
              <li>Provide and improve our services</li>
              <li>Personalize content</li>
              <li>Analyze usage and performance</li>
              <li>Enable features that require LinkedIn data</li>
              <li>Communicate with users regarding updates or support</li>
            </ul>
            <p className="text-text-secondary leading-relaxed mt-4 font-semibold">
              We do not sell or rent user data.
            </p>
          </section>

          {/* How We Share Information */}
          <section className="mb-12" aria-labelledby="data-sharing-heading">
            <h2 id="data-sharing-heading" className="text-2xl font-semibold text-text-primary mb-4">4. How We Share Information</h2>
            <p className="text-text-secondary leading-relaxed mb-4">
              We may share information only with:
            </p>
            <ul className="list-disc pl-6 mb-4 text-text-secondary space-y-2">
              <li>Third-party service providers that help us operate our service (e.g., hosting providers, analytics tools)</li>
              <li>LinkedIn, as required by their API usage policies</li>
            </ul>
            <p className="text-text-secondary leading-relaxed mt-4 font-semibold">
              We do not share personal data with advertisers or unrelated third parties.
            </p>
          </section>

          {/* Data Storage & Security */}
          <section className="mb-12" aria-labelledby="data-security-heading">
            <h2 id="data-security-heading" className="text-2xl font-semibold text-text-primary mb-4">5. Data Storage & Security</h2>
            <p className="text-text-secondary leading-relaxed mb-4">
              We use reasonable administrative and technical measures to protect user data.
            </p>
            <p className="text-text-secondary leading-relaxed">
              While no method of transmission is 100% secure, we are committed to safeguarding information.
            </p>
          </section>

          {/* LinkedIn API Compliance */}
          <section className="mb-12" aria-labelledby="linkedin-api-heading">
            <h2 id="linkedin-api-heading" className="text-2xl font-semibold text-text-primary mb-4">6. LinkedIn API Compliance</h2>
            <p className="text-text-secondary leading-relaxed mb-4">
              Our use of LinkedIn data fully adheres to:
            </p>
            <ul className="list-disc pl-6 mb-4 text-text-secondary space-y-2">
              <li>LinkedIn API Terms of Use</li>
              <li>LinkedIn Marketing Developer Platform Policies</li>
              <li>LinkedIn Data Protection rules</li>
            </ul>
            <p className="text-text-secondary leading-relaxed mb-4">
              Users can revoke access at any time via their LinkedIn settings.
            </p>
            <p className="text-text-secondary leading-relaxed">
              We only access data necessary for the features of our platform.
            </p>
          </section>

          {/* Cookies & Tracking */}
          <section className="mb-12" aria-labelledby="cookies-heading">
            <h2 id="cookies-heading" className="text-2xl font-semibold text-text-primary mb-4">7. Cookies & Tracking</h2>
            <p className="text-text-secondary leading-relaxed mb-4">
              We may use:
            </p>
            <ul className="list-disc pl-6 mb-4 text-text-secondary space-y-2">
              <li>Cookies</li>
              <li>Local storage</li>
              <li>Analytics scripts</li>
            </ul>
            <p className="text-text-secondary leading-relaxed mt-4">
              Users can disable cookies through browser settings.
            </p>
          </section>

          {/* User Rights */}
          <section className="mb-12" aria-labelledby="user-rights-heading">
            <h2 id="user-rights-heading" className="text-2xl font-semibold text-text-primary mb-4">8. User Rights</h2>
            <p className="text-text-secondary leading-relaxed mb-4">
              Users may:
            </p>
            <ul className="list-disc pl-6 mb-4 text-text-secondary space-y-2">
              <li>Request access to their data</li>
              <li>Request deletion of their data</li>
              <li>Revoke LinkedIn permissions</li>
              <li>Contact us for clarification</li>
            </ul>
            <p className="text-text-secondary leading-relaxed mt-4">
              <strong>Contact:</strong> incontentai@gmail.com
            </p>
          </section>

          {/* Children's Privacy */}
          <section className="mb-12" aria-labelledby="childrens-privacy-heading">
            <h2 id="childrens-privacy-heading" className="text-2xl font-semibold text-text-primary mb-4">9. Children&apos;s Privacy</h2>
            <p className="text-text-secondary leading-relaxed">
              We do not knowingly collect data from individuals under the age of 13.
            </p>
          </section>

          {/* Changes to This Policy */}
          <section className="mb-12" aria-labelledby="policy-changes-heading">
            <h2 id="policy-changes-heading" className="text-2xl font-semibold text-text-primary mb-4">10. Changes to This Policy</h2>
            <p className="text-text-secondary leading-relaxed mb-4">
              We may update this Privacy Policy as we continue building.
            </p>
            <p className="text-text-secondary leading-relaxed">
              Updates will be posted with a new &quot;Last Updated&quot; date.
            </p>
          </section>

          {/* Contact Information */}
          <section className="mb-12" aria-labelledby="contact-information-heading">
            <h2 id="contact-information-heading" className="text-2xl font-semibold text-text-primary mb-4">11. Contact Information</h2>
            <p className="text-text-secondary leading-relaxed mb-4">
              For questions or concerns, contact us at:
            </p>
            <div className="bg-surface p-6 rounded-lg mt-4">
              <p className="text-text-secondary mb-2">
                <strong>Email:</strong> incontentai@gmail.com
              </p>
            </div>
          </section>
        </div>
      </div>
    </article>
  );
}
