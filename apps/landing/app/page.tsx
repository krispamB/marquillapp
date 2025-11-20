import Hero from '@/components/Hero';
import Features from '@/components/Features';

export const metadata = {
  title: 'inContentai for LinkedIn - AI-Powered LinkedIn Content Creation',
  description: 'Create high-quality LinkedIn posts effortlessly. AI-powered research, writing, and scheduling tools for professionals who want to post smarter, not harder.',
  keywords: 'LinkedIn content, AI writing, content creation, LinkedIn posts, social media automation, professional networking',
  openGraph: {
    title: 'inContentai for LinkedIn - AI-Powered LinkedIn Content Creation',
    description: 'Create high-quality LinkedIn posts effortlessly. AI-powered research, writing, and scheduling tools for professionals.',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'inContentai for LinkedIn - AI-Powered LinkedIn Content Creation',
    description: 'Create high-quality LinkedIn posts effortlessly with AI-powered tools.',
  },
};

export default function Home() {
  return (
    <>
      {/* Hero Section */}
      <Hero />

      {/* Features Section */}
      <Features />

      {/* Additional LinkedIn-Focused Messaging Section */}
      <section className="py-20 bg-white" aria-labelledby="linkedin-focus-heading">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <h2 id="linkedin-focus-heading" className="text-3xl sm:text-4xl font-bold text-text-primary mb-6">
              Built Specifically for LinkedIn Success
            </h2>
            <p className="text-lg text-text-secondary mb-8 leading-relaxed">
              Unlike generic content tools, inContentai is designed exclusively for LinkedIn. 
              Every feature is optimized to help you create posts that resonate with your 
              professional network, drive engagement, and establish your thought leadership 
              on the world&apos;s largest professional platform.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-12">
              <div className="p-6">
                <div className="text-4xl font-bold text-primary mb-2">10x</div>
                <p className="text-text-secondary">Faster content creation for LinkedIn</p>
              </div>
              <div className="p-6">
                <div className="text-4xl font-bold text-primary mb-2">100%</div>
                <p className="text-text-secondary">Focused on LinkedIn best practices</p>
              </div>
              <div className="p-6">
                <div className="text-4xl font-bold text-primary mb-2">24/7</div>
                <p className="text-text-secondary">AI-powered LinkedIn content assistant</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Call-to-Action Section */}
      <section className="py-20 bg-gradient-to-br from-primary to-primary/90" aria-labelledby="cta-heading">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center">
            <h2 id="cta-heading" className="text-3xl sm:text-4xl font-bold text-white mb-6">
              Ready to Transform Your LinkedIn Presence?
            </h2>
            <p className="text-xl text-white/90 mb-8">
              Join professionals who are creating better LinkedIn content in less time
            </p>
            <button
              className="bg-white text-primary px-8 py-4 rounded-lg font-semibold text-lg hover:bg-gray-50 transition-all duration-200 shadow-lg hover:shadow-xl hover:scale-105 inline-flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-primary min-h-[44px]"
              aria-label="Start creating LinkedIn content"
            >
              Get Started Now
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
        </div>
      </section>
    </>
  );
}
