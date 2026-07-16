import MarquillMark from './MarquillMark';
import MarquillWordmark, { type WordmarkFont } from './MarquillWordmark';

type Theme = 'auto' | 'light' | 'dark';

interface MarquillLockupProps {
  /** Icon height in px; the wordmark + gap scale from this. */
  size?: number;
  theme?: Theme;
  /** Wordmark typeface. Defaults to Courier Prime. */
  font?: WordmarkFont;
  className?: string;
}

/**
 * MarquillLockup — the icon and "marquill_" wordmark locked together.
 * Spacing derives from `size`: wordmark ≈ 0.72×, gap ≈ 0.3× the icon.
 * Tuned so the wordmark's cap height optically aligns with the tile.
 */
export default function MarquillLockup({
  size = 36,
  theme = 'auto',
  font = 'courier-prime',
  className = '',
}: MarquillLockupProps) {
  const gap = Math.round(size * 0.3);
  const word = Math.round(size * 0.72);

  return (
    <span
      className={`inline-flex items-center ${className}`}
      style={{ gap }}
      aria-label="Marquill"
    >
      <MarquillMark size={size} theme={theme} title="" />
      <MarquillWordmark size={word} theme={theme} font={font} />
    </span>
  );
}
