/**
 * What one render session measured (§5.1, step 5 and 6). The probe and the
 * font pass produce these; `judge()` is the only thing that reads them against
 * a Design System Definition. Facts hold no policy, so the judge can be tested
 * on recorded facts without a browser.
 *
 * Coordinates are CSS px on the document canvas: page `i` (1-based) starts at
 * `y = (i - 1) * page.height`.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ProbePage {
  /** One-based, document order. */
  index: number;
  role: string | null;
  rect: Rect;
}

export interface ProbeElement {
  /** Position in `section.page *` document order; the font pass keys on it. */
  idx: number;
  /** One-based page element the element sits in. */
  page: number;
  /** The locator a model can find: tag, classes and a text snippet. */
  label: string;
  tag: string;
  rect: Rect;
  /** Glyph boxes of the element's own (direct-child) text. Empty: no text. */
  textRects: Rect[];
  /** Computed `color`, as the browser serialises it. */
  color: string;
  /**
   * The text is painted translucent: a colour with alpha, or the element or an
   * ancestor composites through `opacity`, `mix-blend-mode` or `filter`.
   */
  translucent: boolean;
  /**
   * Per `textRects` entry, the effective background under the centre of that
   * line: an opaque computed colour, or `null` when what is under it has no
   * single colour (a gradient, an image, a translucent or composited paint).
   */
  backgrounds: (string | null)[];
  /** Whether the element paints a box of its own (background, border, svg, hr). */
  paints: boolean;
  /**
   * The element or an ancestor below the page is absolutely positioned: it
   * was placed, outside the flow, rather than laid out.
   */
  placed: boolean;
  /** The nearest element, itself included, below the page whose `overflow` clips. */
  clip: { label: string; rect: Rect } | null;
  /** The `data-icon` name of an inlined icon. */
  icon: string | null;
  /** Computed `line-height` in px, or `null` for `normal`. */
  lineHeight: number | null;
}

export interface FontFaceFact {
  family: string;
  weight: string;
  style: string;
  /** `FontFace.status`: `unloaded`, `loading`, `loaded` or `error`. */
  status: string;
}

/** What `CSS.getPlatformFontsForNode` reports painted an element's glyphs. */
export interface PlatformFont {
  familyName: string;
  isCustomFont: boolean;
  glyphCount: number;
}

export interface RenderFacts {
  /** The session deadline expired; nothing else measured is trustworthy. */
  timedOut: boolean;
  pages: ProbePage[];
  elements: ProbeElement[];
  faces: FontFaceFact[];
  /** Keyed by `ProbeElement.idx`, for elements with text. */
  platformFonts: Record<number, PlatformFont[]>;
  /** URLs the session refused, each once, in the order first requested. */
  refusedRequests: string[];
  /** Pages in the printed PDF, or `null` when the session never printed. */
  pdfPageCount: number | null;
}

/** Facts for a session that measured nothing. */
export const emptyRenderFacts = (): RenderFacts => ({
  timedOut: false,
  pages: [],
  elements: [],
  faces: [],
  platformFonts: {},
  refusedRequests: [],
  pdfPageCount: null,
});
