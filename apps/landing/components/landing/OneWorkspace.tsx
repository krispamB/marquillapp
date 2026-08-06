import { formats, Icon, Eyebrow } from './data';

const FEATURES = [
  {
    title: 'Multi-account control',
    body: 'Mark switches voice per profile and page.',
    paths: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
    extra: <circle cx="9" cy="7" r="4" />,
  },
  {
    title: 'Timezone-aware scheduling',
    body: 'Queue locally, Mark publishes at peak.',
    paths: ['M3 4h18v18H3z', 'M16 2v4', 'M8 2v4', 'M3 10h18'],
  },
  {
    title: 'Post analytics',
    body: 'Mark reads what lands and learns from it.',
    paths: ['M18 20V10', 'M12 20V4', 'M6 20v-6'],
  },
];

export default function OneWorkspace() {
  return (
    <section id="what-mark-makes" className="perf-section border-t border-line bg-surface px-5 py-16 sm:px-6 sm:py-20 lg:px-16 lg:py-[72px]">
      <div className="mx-auto max-w-[640px] text-center">
        <Eyebrow>_ one workspace</Eyebrow>
        <h2 className="mt-3 text-[28px] font-bold leading-[1.05] tracking-[-0.03em] text-ink-900 sm:text-[36px] lg:text-[40px]">
          Mark works where you already post
        </h2>
        <p className="mt-3.5 text-[16px] leading-[1.5] text-ink-500 sm:text-[17px]">
          Drafts, carousels, polls, scheduling, and analytics — without hopping between tools.
        </p>
      </div>

      {/* format pills */}
      <div className="mx-auto mt-8 flex max-w-[760px] flex-wrap justify-center gap-2.5">
        {formats.map((fmt) => (
          <span
            key={fmt.label}
            className="inline-flex items-center gap-2.5 rounded-full border border-line bg-surface px-[18px] py-[11px] text-[14.5px] font-semibold text-ink-900 shadow-xs"
          >
            <Icon paths={fmt.paths} size={17} />
            {fmt.label}
          </span>
        ))}
      </div>

      {/* feature panel */}
      <div className="mx-auto mt-11 grid max-w-[1100px] items-center gap-6 rounded-[18px] border border-line bg-canvas p-7 sm:p-10 lg:grid-cols-2">
        <div>
          <h3 className="text-[22px] font-bold leading-[1.12] tracking-[-0.022em] text-ink-900 sm:text-[26px]">
            Built for founders, creators, and teams who publish at scale.
          </h3>
          <p className="mt-3.5 text-[16px] leading-[1.55] text-ink-500">
            Hand Mark multiple LinkedIn accounts. He drafts in each voice, schedules, publishes, and
            reads the analytics back — so your pipeline stays steady as output grows.
          </p>
          <a
            href="mailto:hello@marquill.com"
            className="mt-5 inline-flex min-h-[46px] items-center gap-2 rounded-[10px] border border-line-strong bg-surface px-[22px] text-[15px] font-semibold text-ink-900 transition-colors hover:bg-surface-2"
          >
            Talk to sales →
          </a>
        </div>

        <div className="flex flex-col gap-2.5">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex items-center gap-3 rounded-[12px] border border-line bg-surface px-4 py-3.5">
              <span className="inline-flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] bg-canvas-sub text-ink-700" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  {f.paths.map((d, i) => (
                    <path key={i} d={d} />
                  ))}
                  {f.extra}
                </svg>
              </span>
              <div>
                <div className="text-[14.5px] font-semibold text-ink-900">{f.title}</div>
                <div className="text-[13px] text-ink-500">{f.body}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
