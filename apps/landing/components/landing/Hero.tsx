import { MarkCursor } from './data';

export default function Hero() {
  return (
    <section id="top" className="bg-surface px-5 pb-14 pt-14 text-center sm:px-6 sm:pt-20 lg:px-8">
      <div className="mx-auto max-w-[840px]">
        {/* Eyebrow badge */}
        <span className="ff-mono inline-flex items-center gap-2 rounded-full border border-line bg-surface px-[13px] py-1.5 text-[12.5px] font-medium text-ink-700 shadow-xs">
          meet mark, your linkedin agent
          <MarkCursor />
        </span>

        {/* Headline */}
        <h1 className="mx-auto mt-6 max-w-[840px] text-[34px] font-bold leading-[1.04] tracking-[-0.038em] text-balance sm:text-[48px] sm:leading-[1.02] lg:text-[60px]">
          <span className="text-ink-900">Just tell Mark what to post.</span>
          <br />
          <span className="text-ink-500">He writes it, designs it, and ships it.</span>
        </h1>

        {/* Sub-copy */}
        <p className="mx-auto mt-5 max-w-[600px] text-[16px] leading-[1.5] tracking-[-0.006em] text-ink-500 text-pretty sm:mt-6 sm:text-[19px]">
          Marquill is your AI LinkedIn workspace. Mark drafts posts, designs carousels, and builds
          polls — in your voice, across every account, ready to publish.
        </p>

        {/* Prompt bar */}
        <div className="mx-auto mt-8 flex max-w-[620px] items-center gap-3 rounded-[14px] border border-line-strong bg-surface p-3 pl-4 text-left shadow-md">
          <span className="relative inline-flex h-[30px] w-[30px] flex-none items-end justify-end rounded-[8px] bg-ink-900 p-[2px_3px]" aria-hidden="true">
            <span className="ff-mono text-[8px] font-medium leading-none text-surface">mq</span>
          </span>
          <span className="flex flex-1 items-center text-[14px] text-ink-400 sm:text-[15.5px]">
            Ask Mark to write a post about our Series A…
            <MarkCursor />
          </span>
          <span className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-[10px] bg-ink-900 text-surface" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </span>
        </div>

        {/* Suggestion chips */}
        <div className="mt-3.5 flex flex-wrap justify-center gap-2">
          {['Write a post', 'Design a carousel', 'Run a poll'].map((chip) => (
            <span
              key={chip}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-[13px] text-ink-700"
            >
              {chip}
            </span>
          ))}
        </div>

        {/* Mark's output card — mobile only */}
        <div className="mx-auto mt-9 max-w-[660px] overflow-hidden rounded-[18px] border border-line bg-surface text-left shadow-lg lg:hidden">
          <div className="flex items-center gap-[11px] border-b border-line-faint px-[18px] py-3.5">
            <span className="relative inline-flex h-[34px] w-[34px] flex-none items-end justify-end rounded-[9px] bg-ink-900 p-[2px_3px]" aria-hidden="true">
              <span className="ff-mono text-[8px] font-medium leading-none text-surface">mq</span>
            </span>
            <div className="flex flex-col leading-tight">
              <span className="text-[14px] font-semibold text-ink-900">Mark drafted this</span>
              <span className="text-[12px] text-ink-500">Posting as you · in 4s</span>
            </div>
            <span className="ml-auto inline-flex h-[22px] w-[22px] items-center justify-center rounded-[6px] bg-[#0a66c2] text-[11px] font-bold text-white" aria-hidden="true">
              in
            </span>
          </div>

          <div className="flex gap-1.5 px-[18px] pt-3">
            <span className="rounded-[9px] bg-ink-900 px-[13px] py-[7px] text-[13px] font-semibold text-surface">Post</span>
            <span className="rounded-[9px] border border-line bg-surface px-[13px] py-[7px] text-[13px] font-medium text-ink-700">Carousel</span>
            <span className="rounded-[9px] border border-line bg-surface px-[13px] py-[7px] text-[13px] font-medium text-ink-700">Poll</span>
          </div>

          <div className="px-[18px] py-4">
            <p className="text-[15.5px] leading-[1.55] text-ink-800">
              We just closed our Series A. Here are the three lessons from the last 90 days that
              actually moved the needle — and the one mistake I&apos;d never make again. 🧵
            </p>
            <p className="mt-2.5 text-[15.5px] leading-[1.55] text-ink-500">
              Most teams optimize for launch day. We optimized for the week after…
            </p>
          </div>

          <div className="flex items-center gap-2.5 border-t border-line-faint px-[18px] py-3.5">
            <span className="inline-flex items-center gap-2 text-[13px] text-ink-500">
              <span className="animate-mq-pulse h-[7px] w-[7px] rounded-full bg-accent" aria-hidden="true" />
              Mark is refining the hook
            </span>
            <span className="ml-auto inline-flex min-h-10 items-center gap-2 rounded-[10px] border border-line-strong bg-surface px-4 text-[14px] font-semibold text-ink-900">
              Schedule
            </span>
            <span className="inline-flex min-h-10 items-center gap-2 rounded-[10px] bg-ink-900 px-[18px] text-[14px] font-semibold text-surface">
              Publish
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
