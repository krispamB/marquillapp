import InformateCarousel from '@/components/InformateCarousel';

export const metadata = {
  title: 'Marquill - AI-Powered LinkedIn Content Platform',
  description:
    'Marquill helps LinkedIn creators generate posts from YouTube research, schedule content, and publish faster.',
  keywords: 'LinkedIn content, AI post generator, YouTube research, scheduling, publishing',
  openGraph: {
    title: 'Marquill - AI-Powered LinkedIn Content Platform',
    description: 'Generate LinkedIn posts from YouTube research, schedule, and publish in one place.',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Marquill - AI-Powered LinkedIn Content Platform',
    description: 'Generate LinkedIn posts from YouTube research, schedule, and publish in one place.',
  },
};

const stats = [
  { value: '150–300', label: 'Word range per post type' },
  { value: '3K', label: 'LinkedIn character guardrails' },
  // { value: '30s', label: 'Auto-save cadence in editor' },
  // { value: 'Multi', label: 'Personal + company pages' },
  // { value: 'TZ Smart', label: 'Timezone-aware scheduling' },
];

const pricing = [
  {
    name: 'Free',
    price: '$0',
    description: 'Get started with core creation and publishing.',
    features: ['1 LinkedIn account', '5 AI posts / month', '3 scheduled posts queued', '30 days post history'],
  },
  {
    name: 'Starter',
    price: '$9',
    description: 'For consistent weekly posting.',
    features: ['1 LinkedIn account', '30 AI posts / month', '10 scheduled posts queued', '90 days post history'],
  },
  {
    name: 'Creator',
    price: '$29',
    description: 'Best for creators scaling output.',
    features: ['2 LinkedIn accounts', '100 AI posts / month', '50 scheduled posts queued', '1 year post history'],
    featured: true,
  },
  {
    name: 'Pro Writers',
    price: '$79',
    description: 'High-volume teams and agencies.',
    features: ['10 LinkedIn accounts', 'Unlimited AI posts', 'Unlimited scheduled posts', 'Unlimited post history'],
  },
];

const techLogos: Record<string, string> = {
  linkedin: 'https://res.cloudinary.com/dnpvndlmy/image/upload/v1770729052/marquill/LinkedIn_Symbol_2_pxns94.webp',
  claude: 'https://res.cloudinary.com/dnpvndlmy/image/upload/v1770729120/marquill/claude-color_ag3brm.webp',
  chatgpt: 'https://res.cloudinary.com/dnpvndlmy/image/upload/v1770729120/marquill/openai_qrnbyx.webp',
  perplexity: 'https://res.cloudinary.com/dnpvndlmy/image/upload/v1770729120/marquill/perplexity-color_olnehj.webp',
  youtube: 'https://res.cloudinary.com/dnpvndlmy/image/upload/v1770729022/marquill/YouTube_Symbol_2_yerobm.webp',
};

const faqs = [
  {
    question: 'What makes Marquill different from generic AI writers?',
    answer:
      'Marquill turns YouTube research into LinkedIn-ready posts. You can generate, edit, schedule, and publish without leaving the platform.',
  },
  {
    question: 'Can I connect multiple LinkedIn accounts?',
    answer:
      'Yes. Connect personal profiles and company pages, then filter drafts and schedules by account.',
  },
  {
    question: 'How does YouTube research work?',
    answer:
      'Select a post type, add your topic, and Marquill pulls context from YouTube to build a concise, LinkedIn-length draft.',
  },
  {
    question: 'Can I schedule posts in my local timezone?',
    answer:
      'Yes. Scheduling is timezone-aware so you can set local publish times while we store and process in UTC.',
  },
  {
    question: 'What about images?',
    answer:
      'Search stock images or upload your own. We handle LinkedIn-ready sizing and attach assets to your post.',
  },
];

export default function Home() {
  return (
    <div className="bg-gradient-to-b from-white via-[#F6F2FF] to-[#EAF1FF]">
      <section className="relative overflow-hidden">
        <div className="mobile-decor absolute -top-40 right-10 h-80 w-80 rounded-full bg-gradient-to-br from-[#C9D4FF] via-[#D8C8FF] to-[#F2C8FF] opacity-60 blur-3xl" />
        <div className="mobile-decor absolute top-40 left-10 h-72 w-72 rounded-full bg-gradient-to-br from-[#B7E2FF] via-[#D4E7FF] to-[#E5D9FF] opacity-70 blur-3xl" />

        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 pt-24 pb-24 text-center">
          <div className="grid grid-cols-1 items-center">
            <div>
              <div className="mx-auto inline-flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-xs font-semibold text-text-secondary shadow-sm">
                <span className="h-2 w-2 rounded-full bg-[#5B5CF6]" />
                Built for LinkedIn creators and teams
              </div>
              <h1 className="mt-6 text-4xl sm:text-5xl lg:text-6xl font-semibold text-text-primary leading-tight">
                Your LinkedIn
                <span className="block text-transparent bg-clip-text bg-gradient-to-r from-[#4F5BFF] via-[#7A5BFF] to-[#A56BFF]">
                  content engine
                </span>
              </h1>
              <p className="mt-6 text-lg text-[#3F3E4F] max-w-2xl mx-auto">
                Generate LinkedIn posts from YouTube research, edit in a focused draft editor, and schedule or publish
                across personal and company pages in minutes.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-4">
                <button className="rounded-full bg-[#1B1C2A] px-6 py-3 text-sm font-semibold text-white shadow-lg">
                  Start free
                </button>
                <a
                  href="#how-it-works"
                  className="rounded-full border border-[#CBD2FF] bg-white/80 px-6 py-3 text-sm font-semibold text-text-primary"
                >
                  See how it works
                </a>
              </div>
              <div className="mt-6 flex items-center justify-center gap-3 text-sm text-text-secondary">
                <div className="flex -space-x-2">
                  {['#C8D1FF', '#E1D5FF', '#BBDCFD'].map((color) => (
                    <span
                      key={color}
                      className="h-8 w-8 rounded-full border-2 border-white"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                Mobile-optimized for creators on the move.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="perf-section relative" id="informate">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-20">
          <InformateCarousel />
        </div>
      </section>

      <section id="how-it-works" className="perf-section py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-3xl sm:text-4xl font-semibold text-text-primary">How Marquill Works</h2>
            <p className="mt-4 text-text-secondary max-w-2xl mx-auto">
              Three focused steps to go from research to published LinkedIn posts.
            </p>
          </div>
          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                title: 'Connect your accounts',
                copy: 'Link personal profiles and company pages with secure OAuth access.',
                gif: 'https://res.cloudinary.com/dnpvndlmy/image/upload/v1770688525/marquill/account-linking_cfzuku.gif',
              },
              {
                title: 'Generate your draft',
                copy: 'Pick Quick or Insight posts and create a 150–300 word LinkedIn draft.',
                gif: 'https://res.cloudinary.com/dnpvndlmy/image/upload/v1770688525/marquill/ai-draft_iwqson.gif',
              },
              {
                title: 'Schedule or publish',
                copy: 'Set local publish times or xpost instantly with LinkedIn-ready validation.',
                gif: 'https://res.cloudinary.com/dnpvndlmy/image/upload/v1770688525/marquill/publishing_arxvh0.gif',
              },
            ].map((card, index) => (
              <div key={card.title} className="rounded-3xl bg-white/80 p-6 shadow-lg border border-white/70">
                <div className="h-48 overflow-hidden rounded-2xl border border-slate-200/60 bg-white">
                  <img
                    src={card.gif}
                    alt={`${card.title} demo`}
                    className="h-full w-full object-contain p-2"
                    loading="lazy"
                    decoding="async"
                    fetchPriority="low"
                    width={400}
                    height={400}
                  />
                </div>
                <div className="text-xs font-semibold text-[#5B5CF6]">0{index + 1}</div>
                <h3 className="mt-3 text-lg font-semibold text-text-primary">{card.title}</h3>
                <p className="mt-3 text-sm text-text-secondary">{card.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="perf-section py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-10 items-center">
            <div>
              <h2 className="text-3xl sm:text-4xl font-semibold text-text-primary">Everything you need to ship</h2>
              <p className="mt-4 text-text-secondary">
                Manage drafts, scheduling, images, and publishing without hopping between tools.
              </p>
            </div>
            <div className="orbit-wrap">
              <div className="orbit-center">
                {techLogos.linkedin ? (
                  <img src={techLogos.linkedin} alt="LinkedIn" className="orbit-center-logo" />
                ) : (
                  <span className="orbit-placeholder" aria-label="LinkedIn logo placeholder" />
                )}
              </div>
              <div className="orbit-ring">
                {Object.entries(techLogos)
                  .filter(([key]) => key !== 'linkedin')
                  .map(([key, src], index, arr) => (
                    <div
                      key={key}
                      className="orbit-item"
                      style={{
                        ['--orbit-angle' as string]: `${index * (360 / arr.length)}deg`,
                        ['--float-delay' as string]: `${index * 0.5}s`,
                      }}
                    >
                      <div className="orbit-badge">
                        {src ? (
                          <img src={src} alt={key} className="orbit-logo" />
                        ) : (
                          <span className="orbit-placeholder" aria-label={`${key} logo placeholder`} />
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="perf-section py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-[32px] border border-white/70 bg-white/80 p-10 shadow-2xl">
            <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-10 items-center">
              <div>
                <h3 className="text-2xl sm:text-3xl font-semibold text-text-primary">
                  Teams and agencies scale faster
                </h3>
                <p className="mt-4 text-text-secondary">
                  Manage multiple LinkedIn accounts, keep drafts organized, and monitor usage limits per tier. Marquill
                  keeps your publishing pipeline steady as output grows.
                </p>
                <button className="mt-6 rounded-full bg-[#1B1C2A] px-6 py-3 text-sm font-semibold text-white">
                  Talk to sales
                </button>
              </div>
              <div className="rounded-3xl bg-[#0F111A] p-6 text-white shadow-xl">
                <p className="text-sm text-white/70">Customer spotlight</p>
                <p className="mt-4 text-lg font-semibold">
                  “We went from scattered drafts to a reliable LinkedIn cadence in one week.”
                </p>
                <div className="mt-6 flex items-center gap-3">
                  <span className="h-10 w-10 rounded-full bg-white/20" />
                  <div>
                    <div className="text-sm font-semibold">Sade Adebayo</div>
                    <div className="text-xs text-white/70">Head of Content, Lumen Studio</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
            {stats.map((stat) => (
              <div key={stat.value} className="rounded-2xl bg-white/80 p-5 text-center shadow-sm">
                <div className="text-2xl font-semibold text-text-primary">{stat.value}</div>
                <div className="mt-2 text-xs text-text-secondary">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="perf-section py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <p className="text-sm font-semibold text-[#5B5CF6]">Simple, Transparent Pricing</p>
            <h2 className="mt-4 text-3xl sm:text-4xl font-semibold text-text-primary">
              Pick a plan that matches your output
            </h2>
            <p className="mt-4 text-text-secondary">
              Start free. Upgrade as you add accounts and volume.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-1 lg:grid-cols-4 gap-6">
            {pricing.map((plan) => (
              <div
                key={plan.name}
                className={`rounded-3xl border ${
                  plan.featured
                    ? 'border-[#5B5CF6] bg-white shadow-2xl scale-[1.02]'
                    : 'border-white/80 bg-white/80 shadow-lg'
                } p-8`}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-text-primary">{plan.name}</h3>
                  {plan.featured && (
                    <span className="rounded-full bg-[#EEF0FF] px-3 py-1 text-xs font-semibold text-[#5B5CF6]">
                      Most popular
                    </span>
                  )}
                </div>
                <div className="mt-4 flex items-end gap-2">
                  <span className="text-3xl font-semibold text-text-primary">{plan.price}</span>
                  {plan.price !== '$0' && <span className="text-sm text-text-secondary">/month</span>}
                </div>
                <p className="mt-3 text-sm text-text-secondary">{plan.description}</p>
                <button
                  className={`mt-6 w-full rounded-full px-4 py-3 text-sm font-semibold ${
                    plan.featured
                      ? 'bg-[#1B1C2A] text-white'
                      : 'border border-[#D8DCFF] text-text-primary'
                  }`}
                >
                  {plan.featured ? 'Start creator plan' : 'Start free'}
                </button>
                <ul className="mt-6 space-y-3 text-sm text-text-secondary">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[#5B5CF6]" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="faq" className="perf-section py-20">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-3xl sm:text-4xl font-semibold text-text-primary">
              Frequently Asked Questions
            </h2>
            <p className="mt-3 text-text-secondary">Everything you need to know before you launch.</p>
          </div>
          <div className="mt-10 space-y-4">
            {faqs.map((faq) => (
              <details
                key={faq.question}
                className="group rounded-2xl border border-white/70 bg-white/80 p-6 shadow-sm"
              >
                <summary className="flex cursor-pointer items-center justify-between text-sm font-semibold text-text-primary">
                  {faq.question}
                  <span className="text-[#5B5CF6] group-open:rotate-180 transition-transform">⌃</span>
                </summary>
                <p className="mt-4 text-sm text-text-secondary">{faq.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
