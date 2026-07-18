export default function ClosingCta({ appUrl }: { appUrl: string }) {
  return (
    <section className="bg-surface px-5 pb-16 pt-16 text-center sm:px-6 lg:px-16">
      <h2 className="mx-auto max-w-[640px] text-[28px] font-bold leading-[1.06] tracking-[-0.03em] sm:text-[34px] lg:text-[38px]">
        <span className="text-ink-900">Get started for free.</span>{' '}
        <span className="text-ink-500">Upgrade as you grow.</span>
      </h2>
      <a
        href={appUrl}
        className="mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-[10px] bg-ink-900 px-[26px] text-[15px] font-semibold tracking-[-0.01em] text-surface transition-opacity hover:opacity-90"
      >
        Get started for free →
      </a>
    </section>
  );
}
