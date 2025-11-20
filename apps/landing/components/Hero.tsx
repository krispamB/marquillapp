export default function Hero() {
  return (
    <section className="relative bg-gradient-to-b from-white to-surface py-16 sm:py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Content Column */}
          <div className="text-center lg:text-left">
            {/* Main Headline */}
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-text-primary mb-6 leading-tight">
              inContentai for{' '}
              <span className="text-primary">LinkedIn</span>
            </h1>

            {/* Tagline */}
            <p className="text-xl sm:text-2xl text-text-secondary mb-6 font-medium">
              AI-powered LinkedIn content—researched, written, and ready to post.
            </p>

            {/* Description */}
            <p className="text-lg text-text-secondary mb-8 leading-relaxed">
              This app helps professionals create high-quality LinkedIn posts by automatically 
              researching any topic across trusted platforms and generating polished, data-driven 
              content. It eliminates hours of manual research and writing.
            </p>

            {/* Primary CTA Button */}
            <button
              className="bg-primary text-white px-8 py-4 rounded-lg font-semibold text-lg hover:opacity-90 transition-all duration-200 shadow-lg hover:shadow-xl hover:scale-105 inline-flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 min-h-[44px]"
              aria-label="Get started with inContentai"
            >
              Get Started
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

          {/* Visual Element Column */}
          <div className="relative">
            <div className="aspect-square lg:aspect-auto lg:h-[500px] bg-gradient-to-br from-primary/10 to-secondary/10 rounded-2xl shadow-2xl flex items-center justify-center border border-primary/20">
              {/* Placeholder for illustration or mockup */}
              <div className="text-center p-8">
                <div className="w-24 h-24 mx-auto mb-4 bg-primary/20 rounded-full flex items-center justify-center">
                  <svg
                    className="w-12 h-12 text-primary"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth="2"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
                  </svg>
                </div>
                <p className="text-text-secondary font-medium">
                  Product Illustration
                </p>
                <p className="text-sm text-text-secondary/70 mt-2">
                  Replace with actual mockup or illustration
                </p>
              </div>
            </div>

            {/* Decorative elements */}
            <div className="absolute -top-4 -right-4 w-24 h-24 bg-secondary/20 rounded-full blur-2xl"></div>
            <div className="absolute -bottom-4 -left-4 w-32 h-32 bg-accent/20 rounded-full blur-2xl"></div>
          </div>
        </div>
      </div>
    </section>
  );
}
