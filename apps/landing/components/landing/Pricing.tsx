import { plans, Eyebrow } from './data';

export default function Pricing({ appUrl }: { appUrl: string }) {
  return (
    <section id="pricing" className="perf-section border-t border-line bg-surface px-5 py-16 sm:px-6 sm:py-20 lg:px-16 lg:py-[72px]">
      <div className="mx-auto max-w-[640px] text-center">
        <Eyebrow>_ pricing</Eyebrow>
        <h2 className="mt-3 text-[28px] font-bold leading-[1.05] tracking-[-0.03em] text-ink-900 sm:text-[36px] lg:text-[40px]">
          Pick how hard Mark works
        </h2>
        <p className="mt-3.5 text-[16px] leading-[1.5] text-ink-500 sm:text-[17px]">
          Start free. Upgrade as you add accounts and volume.
        </p>
      </div>

      <div className="mx-auto mt-11 grid max-w-[1100px] items-start gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => (
          <div
            key={plan.name}
            className={`flex flex-col gap-4 rounded-[16px] border bg-surface p-6 shadow-sm ${
              plan.popular ? 'border-accent ring-1 ring-accent/30' : 'border-line'
            }`}
          >
            <div className="flex min-h-6 items-center justify-between">
              <span className="text-[15px] font-semibold text-ink-900">{plan.name}</span>
              {plan.popular && (
                <span className="rounded-full bg-accent px-2.5 py-1 text-[11px] font-semibold text-white">
                  Most popular
                </span>
              )}
            </div>

            <div className="flex items-baseline gap-[3px]">
              <span className="text-[36px] font-bold tabular-nums tracking-[-0.03em] text-ink-900">
                {plan.price}
              </span>
              {plan.period && <span className="text-[14px] text-ink-500">{plan.period}</span>}
            </div>

            <p className="min-h-[38px] text-[13.5px] leading-[1.45] text-ink-500">{plan.blurb}</p>

            <a
              href={appUrl}
              className="inline-flex min-h-11 items-center justify-center rounded-[10px] bg-ink-900 text-[14px] font-semibold tracking-[-0.01em] text-surface transition-opacity hover:opacity-90"
            >
              {plan.cta}
            </a>

            <div className="flex flex-col gap-2.5 border-t border-line-faint pt-1.5">
              {plan.features.map((feat) => (
                <div key={feat} className="flex items-center gap-2.5 text-[13.5px] text-ink-700">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="flex-none" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  {feat}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
