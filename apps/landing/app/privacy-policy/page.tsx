import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy | inContentai for LinkedIn',
  description: 'Privacy Policy for inContentai - Learn how we collect, use, and protect your data when using our AI-powered LinkedIn content creation tool.',
};

export default function PrivacyPolicyPage() {
  return (
    <article className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">Privacy Policy</h1>
        <p className="text-sm text-gray-600 mb-12">Last Updated: November 20, 2025</p>

        <div className="prose prose-lg max-w-none">
          {/* Introduction */}
          <section className="mb-12" aria-labelledby="introduction-heading">
            <h2 id="introduction-heading" className="text-2xl font-semibold text-gray-900 mb-4">Introduction</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              Welcome to inContentai (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;). We are committed to protecting your privacy and ensuring the security of your personal information. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our AI-powered LinkedIn content creation tool.
            </p>
            <p className="text-gray-700 leading-relaxed">
              By using inContentai, you agree to the collection and use of information in accordance with this policy. If you do not agree with our policies and practices, please do not use our service.
            </p>
          </section>

          {/* Information Collection */}
          <section className="mb-12" aria-labelledby="information-collection-heading">
            <h2 id="information-collection-heading" className="text-2xl font-semibold text-gray-900 mb-4">Information Collection</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              We collect several types of information to provide and improve our service:
            </p>
            
            <h3 className="text-xl font-semibold text-gray-900 mb-3 mt-6">Personal Information</h3>
            <p className="text-gray-700 leading-relaxed mb-4">
              When you create an account or use our service, we may collect:
            </p>
            <ul className="list-disc pl-6 mb-4 text-gray-700 space-y-2">
              <li>Name and email address</li>
              <li>LinkedIn profile information (if you choose to connect your account)</li>
              <li>Payment and billing information</li>
              <li>Communication preferences</li>
            </ul>

            <h3 className="text-xl font-semibold text-gray-900 mb-3 mt-6">Content and Usage Data</h3>
            <p className="text-gray-700 leading-relaxed mb-4">
              To provide our AI content creation services, we collect:
            </p>
            <ul className="list-disc pl-6 mb-4 text-gray-700 space-y-2">
              <li>Topics and keywords you provide for content generation</li>
              <li>Generated content drafts and edits</li>
              <li>Scheduling preferences and posting history</li>
              <li>Research sources and materials you upload or reference</li>
            </ul>

            <h3 className="text-xl font-semibold text-gray-900 mb-3 mt-6">Technical Information</h3>
            <p className="text-gray-700 leading-relaxed mb-4">
              We automatically collect certain technical information, including:
            </p>
            <ul className="list-disc pl-6 mb-4 text-gray-700 space-y-2">
              <li>IP address and device information</li>
              <li>Browser type and version</li>
              <li>Usage patterns and feature interactions</li>
              <li>Cookies and similar tracking technologies</li>
            </ul>
          </section>

          {/* Data Usage */}
          <section className="mb-12" aria-labelledby="data-usage-heading">
            <h2 id="data-usage-heading" className="text-2xl font-semibold text-gray-900 mb-4">Data Usage</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              We use the collected information for the following purposes:
            </p>
            <ul className="list-disc pl-6 mb-4 text-gray-700 space-y-2">
              <li><strong>Service Delivery:</strong> To generate AI-powered LinkedIn content based on your inputs and preferences</li>
              <li><strong>Account Management:</strong> To create and manage your account, process payments, and provide customer support</li>
              <li><strong>Service Improvement:</strong> To analyze usage patterns and improve our AI models and features</li>
              <li><strong>Communication:</strong> To send you service updates, newsletters, and marketing communications (with your consent)</li>
              <li><strong>Security:</strong> To detect, prevent, and address technical issues and fraudulent activity</li>
              <li><strong>Legal Compliance:</strong> To comply with applicable laws, regulations, and legal processes</li>
            </ul>
          </section>

          {/* AI Processing */}
          <section className="mb-12" aria-labelledby="ai-processing-heading">
            <h2 id="ai-processing-heading" className="text-2xl font-semibold text-gray-900 mb-4">AI Processing</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              Our service uses artificial intelligence to generate LinkedIn content. Here&apos;s how we handle your data in our AI systems:
            </p>
            
            <h3 className="text-xl font-semibold text-gray-900 mb-3 mt-6">Content Generation</h3>
            <p className="text-gray-700 leading-relaxed mb-4">
              When you request content generation, your inputs (topics, keywords, research materials) are processed by our AI models to create personalized LinkedIn posts. This processing happens in real-time and is specific to your request.
            </p>

            <h3 className="text-xl font-semibold text-gray-900 mb-3 mt-6">Model Training</h3>
            <p className="text-gray-700 leading-relaxed mb-4">
              We may use aggregated and anonymized usage data to improve our AI models. We do not use your personal content or identifiable information to train our models without your explicit consent. You can opt out of contributing to model improvement in your account settings.
            </p>

            <h3 className="text-xl font-semibold text-gray-900 mb-3 mt-6">Data Retention for AI</h3>
            <p className="text-gray-700 leading-relaxed mb-4">
              Generated content is stored in your account for your convenience. You can delete any generated content at any time. Once deleted, the content is permanently removed from our systems within 30 days.
            </p>
          </section>

          {/* Third-Party Services */}
          <section className="mb-12" aria-labelledby="third-party-services-heading">
            <h2 id="third-party-services-heading" className="text-2xl font-semibold text-gray-900 mb-4">Third-Party Services</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              We work with trusted third-party service providers to deliver our service:
            </p>
            <ul className="list-disc pl-6 mb-4 text-gray-700 space-y-2">
              <li><strong>AI Service Providers:</strong> We use third-party AI platforms to power our content generation capabilities</li>
              <li><strong>Payment Processors:</strong> We use secure payment processors to handle billing and subscription management</li>
              <li><strong>Analytics Services:</strong> We use analytics tools to understand how users interact with our service</li>
              <li><strong>Cloud Infrastructure:</strong> We use cloud hosting providers to store and process data securely</li>
              <li><strong>LinkedIn API:</strong> If you connect your LinkedIn account, we use LinkedIn&apos;s official API in accordance with their terms of service</li>
            </ul>
            <p className="text-gray-700 leading-relaxed mt-4">
              These third parties are contractually obligated to protect your data and use it only for the purposes we specify. We do not sell your personal information to third parties.
            </p>
          </section>

          {/* Data Security */}
          <section className="mb-12" aria-labelledby="data-security-heading">
            <h2 id="data-security-heading" className="text-2xl font-semibold text-gray-900 mb-4">Data Security</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              We implement industry-standard security measures to protect your information:
            </p>
            <ul className="list-disc pl-6 mb-4 text-gray-700 space-y-2">
              <li><strong>Encryption:</strong> All data transmitted between your device and our servers is encrypted using SSL/TLS protocols</li>
              <li><strong>Access Controls:</strong> We restrict access to personal information to authorized personnel only</li>
              <li><strong>Regular Audits:</strong> We conduct regular security audits and vulnerability assessments</li>
              <li><strong>Data Backup:</strong> We maintain secure backups to prevent data loss</li>
              <li><strong>Incident Response:</strong> We have procedures in place to respond to security incidents promptly</li>
            </ul>
            <p className="text-gray-700 leading-relaxed mt-4">
              While we strive to protect your information, no method of transmission over the internet or electronic storage is 100% secure. We cannot guarantee absolute security but are committed to protecting your data to the best of our ability.
            </p>
          </section>

          {/* User Rights */}
          <section className="mb-12" aria-labelledby="user-rights-heading">
            <h2 id="user-rights-heading" className="text-2xl font-semibold text-gray-900 mb-4">User Rights</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              You have the following rights regarding your personal information:
            </p>
            
            <h3 className="text-xl font-semibold text-gray-900 mb-3 mt-6">Access and Portability</h3>
            <p className="text-gray-700 leading-relaxed mb-4">
              You have the right to access your personal information and request a copy of your data in a portable format.
            </p>

            <h3 className="text-xl font-semibold text-gray-900 mb-3 mt-6">Correction and Update</h3>
            <p className="text-gray-700 leading-relaxed mb-4">
              You can update your account information at any time through your account settings. If you need assistance, contact our support team.
            </p>

            <h3 className="text-xl font-semibold text-gray-900 mb-3 mt-6">Deletion</h3>
            <p className="text-gray-700 leading-relaxed mb-4">
              You have the right to request deletion of your personal information. You can delete your account through your account settings, or contact us for assistance. Please note that some information may be retained for legal or legitimate business purposes.
            </p>

            <h3 className="text-xl font-semibold text-gray-900 mb-3 mt-6">Opt-Out</h3>
            <p className="text-gray-700 leading-relaxed mb-4">
              You can opt out of marketing communications at any time by clicking the unsubscribe link in our emails or updating your communication preferences in your account settings.
            </p>

            <h3 className="text-xl font-semibold text-gray-900 mb-3 mt-6">Data Processing Objection</h3>
            <p className="text-gray-700 leading-relaxed mb-4">
              You have the right to object to certain types of data processing. Contact us to exercise this right.
            </p>
          </section>

          {/* Contact Information */}
          <section className="mb-12" aria-labelledby="contact-information-heading">
            <h2 id="contact-information-heading" className="text-2xl font-semibold text-gray-900 mb-4">Contact Information</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              If you have questions, concerns, or requests regarding this Privacy Policy or our data practices, please contact us:
            </p>
            <div className="bg-gray-50 p-6 rounded-lg mt-4">
              <p className="text-gray-700 mb-2"><strong>Email:</strong> privacy@incontentai.com</p>
              <p className="text-gray-700 mb-2"><strong>Support:</strong> support@incontentai.com</p>
              <p className="text-gray-700"><strong>Response Time:</strong> We aim to respond to all privacy-related inquiries within 48 hours</p>
            </div>
            <p className="text-gray-700 leading-relaxed mt-6">
              We reserve the right to update this Privacy Policy from time to time. We will notify you of any material changes by posting the new Privacy Policy on this page and updating the &quot;Last Updated&quot; date. Your continued use of the service after any changes constitutes acceptance of the updated policy.
            </p>
          </section>
        </div>
      </div>
    </article>
  );
}
