import { steps, Icon, Eyebrow } from './data';

export default function WhatMarkMakes() {
  return (
    <section id="meet-mark" className="perf-section bg-canvas px-5 py-16 sm:px-6 sm:py-20 lg:px-16 lg:py-[72px]">
      <div className="mx-auto max-w-[640px] text-center">
        <Eyebrow>_ what mark makes</Eyebrow>
        <h2 className="mt-3 text-[28px] font-bold leading-[1.05] tracking-[-0.03em] text-ink-900 sm:text-[36px] lg:text-[40px]">
          One agent. Every LinkedIn format.
        </h2>
        <p className="mt-3.5 text-[16px] leading-[1.5] text-ink-500 sm:text-[17px]">
          Ask in plain words. Mark researches, drafts, and designs — then queues it across your accounts.
        </p>
      </div>

      <div className="mx-auto mt-11 grid max-w-[1100px] gap-5 sm:grid-cols-2">
        {steps.map((step) => (
          <div
            key={step.n}
            className="flex items-start gap-[18px] rounded-[14px] border border-line bg-surface p-5 shadow-sm"
          >
            <span className="inline-flex h-[46px] w-[46px] flex-none items-center justify-center rounded-[12px] bg-canvas-sub text-ink-900" aria-hidden="true">
              <Icon paths={step.paths} />
            </span>
            <div>
              <div className="flex items-baseline gap-2.5">
                <span className="ff-mono text-[13px] font-medium text-accent">{step.n}</span>
                <h3 className="text-[18px] font-semibold tracking-[-0.015em] text-ink-900 sm:text-[19px]">
                  {step.title}
                </h3>
              </div>
              <p className="mt-2 text-[14.5px] leading-[1.5] text-ink-500">{step.body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
