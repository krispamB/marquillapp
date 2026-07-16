import { stats } from './data';

export default function Spotlight() {
  return (
    <section className="perf-section bg-canvas px-5 py-12 sm:px-6 lg:px-16">
      <div className="mx-auto max-w-[1100px] rounded-[24px] bg-inverse-bg p-8 text-inverse-fg sm:p-[52px]">
        <span className="ff-mono text-[12px] text-inverse-fg-2">_ customer spotlight</span>
        <div className="mt-[18px] flex items-start gap-[18px]">
          <span className="w-1 flex-none self-stretch rounded bg-accent" aria-hidden="true" />
          <p className="max-w-[780px] text-[20px] font-semibold leading-[1.25] tracking-[-0.02em] text-inverse-fg sm:text-[29px]">
            &ldquo;Mark isn&apos;t a scheduler. He&apos;s the teammate who actually understands what
            makes a LinkedIn post — or carousel — worth reading.&rdquo;
          </p>
        </div>
        <div className="ml-[22px] mt-5 text-[14px] text-inverse-fg-2">
          Sade Adebayo · Head of Content, Lumen Studio
        </div>

        <div className="mt-10 grid grid-cols-2 gap-y-7 border-t border-inverse-line pt-8 sm:flex sm:gap-0">
          {stats.map((stat) => (
            <div key={stat.label} className="sm:flex-1 sm:pr-5">
              <div className="text-[26px] font-bold tabular-nums tracking-[-0.03em] text-inverse-fg sm:text-[32px]">
                {stat.value}
              </div>
              <div className="mt-1.5 text-[12.5px] leading-[1.4] text-inverse-fg-2 sm:text-[13px]">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
