type Theme = 'auto' | 'light' | 'dark';

interface MarquillMarkProps {
  /** Rendered width/height in px (the mark is square). */
  size?: number;
  /**
   * The surface the mark sits on. `light` draws the ink dot; `dark` draws the
   * paper dot. `auto` follows the page's `data-theme` attribute.
   */
  theme?: Theme;
  className?: string;
  title?: string;
}

/** Below this size the eye and caret need more weight to survive anti-aliasing. */
const SMALL_CUT_MAX_SIZE = 24;

const REGULAR_CUT = {
  eye: { x: 17, y: 20, width: 8.5, height: 20, rx: 4.25 },
  caret: { x: 31, y: 34, width: 16, height: 6 },
};

const SMALL_CUT = {
  eye: { x: 15, y: 16, width: 11, height: 26, rx: 5.5 },
  caret: { x: 30.5, y: 33, width: 19.5, height: 9 },
};

const THEME_CLASS: Record<Theme, string> = {
  auto: 'mq-mark-auto',
  light: '',
  dark: 'mq-mark-on-dark',
};

/**
 * MarquillMark — the standalone icon: Mark, a dot with one eye open and the
 * other the underscore from the "marquill_" wordmark. Use anywhere the logo is
 * needed on its own (avatar, compact nav).
 */
export default function MarquillMark({
  size = 40,
  theme = 'auto',
  className = '',
  title = 'Marquill',
}: MarquillMarkProps) {
  const cut = size <= SMALL_CUT_MAX_SIZE ? SMALL_CUT : REGULAR_CUT;
  const classes = ['mq-mark', THEME_CLASS[theme], className].filter(Boolean).join(' ');

  return (
    <span
      className={classes}
      style={{ width: size, height: size }}
      {...(title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true })}
    >
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" focusable="false">
        <circle className="mq-mark-dot" cx="32" cy="32" r="32" />
        <rect className="mq-mark-eye" {...cut.eye} />
        <rect className="mq-mark-caret" {...cut.caret} />
      </svg>
    </span>
  );
}
