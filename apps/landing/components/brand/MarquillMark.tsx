type Theme = 'auto' | 'light' | 'dark';

interface MarquillMarkProps {
  /** Rendered width/height in px (the mark is square). */
  size?: number;
  /**
   * 'auto' follows the page theme via CSS vars; 'light'/'dark' force the
   * palette regardless of theme (light = dark tile, dark = light tile).
   */
  theme?: Theme;
  className?: string;
  title?: string;
}

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
  const appearance = theme === 'dark' ? 'dark' : 'light';

  return (
    <span
      className={`mq-mark mq-mark--${theme} ${className}`}
      role="img"
      aria-label={title}
      style={{ width: size, height: size }}
    >
      <img
        src={`/icon-${appearance}.svg`}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
      />
      {theme === 'auto' && (
        <img
          src="/icon-dark.svg"
          alt=""
          aria-hidden="true"
          width={size}
          height={size}
          className="mq-mark__light"
        />
      )}
    </span>
  );
}
