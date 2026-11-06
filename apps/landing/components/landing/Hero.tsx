import MarquillMark from '../brand/MarquillMark';
import { BetaBadge, MarkCursor } from './data';

const TILE =
  'animate-mq-float flex h-20 w-20 items-center justify-center rounded-[22px] border border-white/10 bg-[#101012] shadow-[0_18px_44px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.06)] xl:h-24 xl:w-24 xl:rounded-[26px]';

type StepState = 'done' | 'active' | 'pending';

const PROGRESS: { label: string; detail: string; state: StepState }[] = [
  { label: 'Research', detail: 'Searched the web, read the top videos and threads', state: 'done' },
  { label: 'Generate', detail: 'Writing 6 slides in Broadside', state: 'active' },
  { label: 'Render', detail: 'Check the layout, then export the PDF', state: 'pending' },
];

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') {
    return (
      <span className="inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-accent text-on-accent" aria-hidden="true">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
    );
  }
  if (state === 'active') {
    return (
      <span className="relative inline-flex h-5 w-5 flex-none items-center justify-center rounded-full border-[1.5px] border-accent" aria-hidden="true">
        <span className="animate-mq-pulse h-2 w-2 rounded-full bg-accent" />
      </span>
    );
  }
  return <span className="inline-flex h-5 w-5 flex-none rounded-full border-[1.5px] border-dashed border-ink-300" aria-hidden="true" />;
}

export default function Hero({ appUrl }: { appUrl: string }) {
  return (
    <section id="top" className="relative isolate overflow-hidden bg-surface px-5 pb-16 pt-14 text-center sm:px-6 sm:pt-20 lg:px-8 lg:pb-20">
      <div className="mq-glow pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />
      <div className="mq-grid pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />

      {/* Decorative tool tiles, desktop only. Two per side, staggered. */}
      <div className="pointer-events-none absolute inset-0 z-0 mx-auto hidden max-w-[1280px] lg:block" aria-hidden="true">
        <div className="absolute left-2 top-[120px] -rotate-6 xl:left-5">
          <div className={`${TILE} p-[22px] xl:p-[26px]`} style={{ animationDuration: '7.5s', animationDelay: '-1.2s' }}>
            <img src="/claude/Symbol.svg" alt="" className="h-full w-full" />
          </div>
        </div>

        <div className="absolute right-2 top-[112px] rotate-6 xl:right-5">
          <div className={`${TILE} p-[15px] xl:p-[18px]`} style={{ animationDuration: '8.6s', animationDelay: '-4.1s' }}>
            <img src="/openAi/OpenAI_Symbol_0.svg" alt="" className="h-full w-full" />
          </div>
        </div>

        <div className="absolute left-4 top-[440px] rotate-[5deg] xl:left-12 xl:top-[448px]">
          <div className={`${TILE} p-[21px] xl:p-[25px]`} style={{ animationDuration: '9.2s', animationDelay: '-2.8s' }}>
            <img src="/linkedIn/LinkedIn_Symbol_0.svg" alt="" className="h-full w-full" />
          </div>
        </div>

        <div className="absolute right-5 top-[468px] -rotate-[7deg] xl:right-14 xl:top-[484px]">
          <div className={`${TILE} overflow-hidden p-0`} style={{ animationDuration: '8.1s', animationDelay: '-5.6s' }}>
            <img src="/canva/Canva_Icon.jpg" alt="" className="h-full w-full rounded-[22px] object-cover xl:rounded-[26px]" />
          </div>
        </div>
      </div>

      <div className="relative z-10 mx-auto max-w-[840px]">
        <BetaBadge>Public beta, open to everyone</BetaBadge>

        <h1 className="mx-auto mt-6 max-w-[820px] text-[34px] font-bold leading-[1.04] tracking-[-0.038em] text-balance sm:text-[48px] sm:leading-[1.02] lg:text-[60px]">
          <span className="text-ink-900">Mark makes your LinkedIn posts, polls, and carousels.</span>{' '}
          <span className="text-ink-500">He&apos;s in public beta, and you can put him to work today.</span>
        </h1>

        <p className="mx-auto mt-5 max-w-[620px] text-[16px] leading-[1.5] tracking-[-0.006em] text-ink-500 text-pretty sm:mt-6 sm:text-[19px]">
          Tell Mark what you want to say. He researches the topic, writes the post or poll, lays out a
          carousel in one of six Design Systems, and schedules it to your profile or company page.
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href={appUrl}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-accent px-[26px] text-[15px] font-semibold tracking-[-0.01em] text-on-accent shadow-md transition-opacity hover:opacity-90 sm:w-auto"
          >
            Join the public beta →
          </a>
          <a
            href="#status"
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[10px] border border-line-strong bg-surface px-[22px] text-[15px] font-semibold tracking-[-0.01em] text-ink-900 transition-colors hover:bg-surface-2 sm:w-auto"
          >
            See what&apos;s live
          </a>
        </div>
        <p className="mt-3 text-[13px] text-ink-400">Free plan, no card.</p>

        {/* Prompt bar */}
        <div className="mx-auto mt-10 flex max-w-[620px] items-center gap-3 rounded-[14px] border border-line-strong bg-surface p-3 pl-4 text-left shadow-md" aria-hidden="true">
          <MarquillMark size={30} title="" />
          <span className="flex min-w-0 flex-1 items-center truncate text-[14px] text-ink-700 sm:text-[15.5px]">
            Turn my launch notes into a 6-slide carousel
            <MarkCursor />
          </span>
          <span className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-[10px] bg-ink-900 text-surface">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </span>
        </div>

        {/* Live progress card */}
        <div
          role="img"
          aria-label="Example of Mark's live progress: research done, generating a 6-slide document in the Broadside Design System, rendering next."
          className="mx-auto mt-3 max-w-[620px] overflow-hidden rounded-[14px] border border-line bg-surface text-left shadow-lg"
        >
          <div className="flex items-center gap-2 border-b border-line-faint px-4 py-3">
            <span className="text-[13.5px] font-semibold text-ink-900">Mark is working</span>
            <span className="ff-mono ml-auto rounded-full border border-line bg-surface-2 px-2 py-[2px] text-[11px] text-ink-500">
              Document · Broadside
            </span>
          </div>
          <ol className="flex flex-col gap-3 px-4 py-4">
            {PROGRESS.map((step) => (
              <li key={step.label} className="flex items-start gap-3">
                <StepIcon state={step.state} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className={`text-[14px] font-semibold ${step.state === 'pending' ? 'text-ink-400' : 'text-ink-900'}`}>
                      {step.label}
                    </span>
                    <span className={`truncate text-[13px] ${step.state === 'active' ? 'text-ink-700' : 'text-ink-500'}`}>
                      {step.detail}
                    </span>
                  </div>
                  {step.state === 'active' && (
                    <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-accent-soft" aria-hidden="true">
                      <div className="animate-mq-sweep h-full w-2/5 rounded-full bg-accent" />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
