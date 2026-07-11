type Theme = 'auto' | 'light' | 'dark';
export type WordmarkFont = 'special-elite' | 'courier-prime' | 'source-code-pro';

interface MarquillWordmarkProps {
  /** Font size in px. */
  size?: number;
  /** 'auto' follows the page theme; 'light'/'dark' force the ink colour. */
  theme?: Theme;
  /** Typeface for the wordmark. Defaults to Courier Prime. */
  font?: WordmarkFont;
  className?: string;
}

function color(theme: Theme) {
  if (theme === 'light') return '#0a0a0a';
  if (theme === 'dark') return '#f4f4f1';
  return 'var(--ink-900)';
}

const FONT_VAR: Record<WordmarkFont, string> = {
  'special-elite': 'var(--font-special-elite)',
  'courier-prime': 'var(--font-courier-prime)',
  'source-code-pro': 'var(--font-source-code-pro)',
};

/**
 * MarquillWordmark — the "marquill_" wordmark with the blinking underscore.
 * Use on its own where the icon would be redundant.
 */
export default function MarquillWordmark({
  size = 28,
  theme = 'auto',
  font = 'courier-prime',
  className = '',
}: MarquillWordmarkProps) {
  return (
    <span
      className={`inline-flex items-baseline leading-none ${className}`}
      style={{
        fontFamily: FONT_VAR[font],
        fontSize: size,
        color: color(theme),
        letterSpacing: '-0.01em',
      }}
      aria-label="marquill"
    >
      marquill
      <span className="animate-mq-blink" aria-hidden="true">
        _
      </span>
    </span>
  );
}
