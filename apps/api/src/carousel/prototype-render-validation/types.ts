/**
 * PROTOTYPE — the facts the render probe collects, and the findings the judge
 * makes from them. Throwaway (issue #163).
 *
 * The split is the design: the probe runs inside the browser and only measures;
 * the judge runs in Node, is pure, and is the only thing that knows the Design
 * System. So every rule is unit-testable against a fixture of measurements, and
 * the code that crosses into the browser holds no policy at all.
 */

/** #162's shape, unchanged. Render findings have no `line`: see README. */
export type Violation = {
  code: string;
  detail: string;
  page?: number;
  line?: number;
};

export type Rect = { x: number; y: number; w: number; h: number };

export type ProbePage = {
  /** 1-based, document order. */
  index: number;
  role: string | null;
  rect: Rect;
};

export type ProbeElement = {
  /** Position in `section.page *` document order; the CDP font pass keys on it. */
  idx: number;
  page: number;
  /** A human- and model-readable locator: `h2.heading "Attention is spent…"`. */
  label: string;
  tag: string;
  rect: Rect;
  /** Line boxes of the element's own (direct-child) text. Empty = no text. */
  textRects: Rect[];
  /** Computed `color`, as the browser serialises it. */
  color: string;
  /**
   * The first painted background walking up from this element: a computed
   * `background-color`, or `null` when a `background-image` is hit first
   * (gradients and images have no single luminance to pair against).
   */
  background: string | null;
  /** Whether the element paints a box of its own (background, border, svg, hr). */
  paints: boolean;
  /** Nearest ancestor below the page whose `overflow` clips, if any. */
  clip: { label: string; rect: Rect } | null;
  icon: string | null;
  /**
   * Computed `line-height` in px, or `null` for `normal`. A Range rect is the
   * glyph box (ascent + descent), which a tight line-height makes taller than
   * the line itself; the judge measures the line.
   */
  lineHeight: number | null;
};

export type FontFaceFact = {
  family: string;
  weight: string;
  style: string;
  status: string;
};

/** What `CSS.getPlatformFontsForNode` reports actually painted an element's glyphs. */
export type PlatformFont = {
  familyName: string;
  isCustomFont: boolean;
  glyphCount: number;
};

export type RenderFacts = {
  timedOut: boolean;
  pages: ProbePage[];
  elements: ProbeElement[];
  faces: FontFaceFact[];
  /** Keyed by `ProbeElement.idx`. */
  platformFonts: Record<number, PlatformFont[]>;
  /** Requests the session refused. Anything here is a checker gap, not a style issue. */
  blockedRequests: string[];
  /** Did any script in the document run? Sentinel read back by the probe. */
  scriptRan: boolean;
  pdfPageCount: number | null;
};
