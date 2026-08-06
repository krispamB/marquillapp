type Theme = 'auto' | 'light' | 'dark';

interface MarquillMarkProps {
  /** Rendered width/height in px (the mark is square). */
  size?: number;
  /**
   * `light` uses the dark-tile asset; `dark` uses the light-tile asset.
   * `auto` follows the page's `data-theme` attribute.
   */
  theme?: Theme;
  className?: string;
  title?: string;
}

const ICON_SOURCE: Record<Exclude<Theme, 'auto'>, string> = {
  light: '/icon-light.svg',
  dark: '/icon-dark.svg',
};

/**
 * MarquillMark — the standalone icon. Use anywhere the lettermark is needed
 * on its own (favicon, avatar, compact nav, app icon).
 */
export default function MarquillMark({
  size = 40,
  theme = 'auto',
  className = '',
  title = 'Marquill',
}: MarquillMarkProps) {
  if (theme !== 'auto') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={ICON_SOURCE[theme]}
        width={size}
        height={size}
        alt={title}
        className={className}
      />
    );
  }

  return (
    <span
      className={`mq-mark-auto ${className}`}
      style={{ width: size, height: size }}
      {...(title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true })}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="mq-mark-auto-light" src={ICON_SOURCE.light} alt="" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="mq-mark-auto-dark" src={ICON_SOURCE.dark} alt="" />
    </span>
  );
}
