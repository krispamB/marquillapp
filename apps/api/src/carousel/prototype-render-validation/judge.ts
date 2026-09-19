/**
 * PROTOTYPE — render facts in, violations out. Pure. Throwaway (issue #163).
 *
 * Codes follow #162's two namespaces: a finding a Design System key owns keeps
 * that key's path (`page.safeArea`, `palette.pairings`, `icons.colors`), and a
 * finding about the render itself is `render.*`.
 */
import type { DesignSystem } from '../prototype-design-system/contract';
import type { ProbeElement, Rect, RenderFacts, Violation } from './types';

/**
 * Tolerance, in px. Blink rounds a font's ascent and descent separately, so a
 * line box sits up to 1px from where half-leading arithmetic puts it (measured:
 * 0.86px on a Fraunces 56px/1.12 heading). A finding within it is rounding.
 */
const EPSILON = 1;
/** Share of the smaller line box that must be covered before text "overlaps". */
const OVERLAP_SHARE = 0.25;

type Rgba = { r: number; g: number; b: number; a: number };

const parseColor = (css: string): Rgba | null => {
  const m = css.match(/^rgba?\(([^)]+)\)$/);
  if (!m) return null;
  const [r, g, b, a = 1] = m[1].split(',').map((s) => Number(s.trim()));
  return { r, g, b, a };
};

const hexToRgb = (hex: string) => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
});

const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
  const [R, G, B] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
};

const contrast = (a: Rgba, b: Rgba) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const area = (r: Rect) => Math.max(0, r.w) * Math.max(0, r.h);

const intersect = (a: Rect, b: Rect): Rect => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    w: Math.min(a.x + a.w, b.x + b.w) - x,
    h: Math.min(a.y + a.h, b.y + b.h) - y,
  };
};

/** How far `inner` pokes out of `outer` on each side, in whole pixels. */
const excess = (inner: Rect, outer: Rect) =>
  (
    [
      ['top', outer.y - inner.y],
      ['right', inner.x + inner.w - (outer.x + outer.w)],
      ['bottom', inner.y + inner.h - (outer.y + outer.h)],
      ['left', outer.x - inner.x],
    ] as const
  ).filter(([, by]) => by > EPSILON);

const union = (rects: Rect[]): Rect => {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return {
    x,
    y,
    w: Math.max(...rects.map((r) => r.x + r.w)) - x,
    h: Math.max(...rects.map((r) => r.y + r.h)) - y,
  };
};

export function judge(ds: DesignSystem, facts: RenderFacts): Violation[] {
  const out: Violation[] = [];
  const add = (code: string, detail: string, page?: number) =>
    out.push(page === undefined ? { code, detail } : { code, detail, page });

  // A render that never settled measured nothing trustworthy.
  if (facts.timedOut) {
    add(
      'render.timeout',
      'the document did not finish loading within the render budget',
    );
    return out;
  }

  const { width, height, safeArea } = ds.page;

  // Token lookup is by the *definition's* hex, never the document's :root —
  // the definition is the authority on what a token is.
  const tokenOf = (css: string): string | null => {
    const c = parseColor(css);
    if (!c || c.a !== 1) return null;
    const t = ds.palette.tokens.find((tok) => {
      const h = hexToRgb(tok.hex);
      return h.r === c.r && h.g === c.g && h.b === c.b;
    });
    return t?.name ?? null;
  };

  // --- pages: geometry, pagination, blankness -----------------------------
  // Absolute, not relative to the previous page: the PDF slices the canvas at
  // multiples of the page height, so a page 48px down the canvas prints 48px of
  // its predecessor at the top of every sheet.
  facts.pages.forEach((p, i) => {
    const { rect } = p;
    const expectedY = i * height;
    if (
      Math.abs(rect.w - width) > EPSILON ||
      Math.abs(rect.h - height) > EPSILON ||
      Math.abs(rect.x) > EPSILON ||
      Math.abs(rect.y - expectedY) > EPSILON
    )
      add(
        'render.pages.geometry',
        `page box is ${Math.round(rect.w)}x${Math.round(rect.h)} at y=${Math.round(rect.y)}; ` +
          `the canvas is ${width}x${height} at y=${Math.round(expectedY)}`,
        p.index,
      );
  });

  if (facts.pdfPageCount !== null && facts.pdfPageCount !== facts.pages.length)
    add(
      'render.pdf.pageCount',
      `the PDF has ${facts.pdfPageCount} pages but the document has ${facts.pages.length} page elements; ` +
        'something forced or spilled a page break',
    );

  for (const p of facts.pages) {
    const shows = facts.elements.some(
      (e) => e.page === p.index && (e.textRects.length > 0 || e.icon),
    );
    if (!shows)
      add('render.pages.blank', 'page shows no text and no icon', p.index);
  }

  // --- geometry of content: safe area, clipping, overlap ------------------
  const pageBox = (n: number) => facts.pages.find((p) => p.index === n)!.rect;
  const safeBox = (n: number): Rect => {
    const r = pageBox(n);
    return {
      x: r.x + safeArea.left,
      y: r.y + safeArea.top,
      w: r.w - safeArea.left - safeArea.right,
      h: r.h - safeArea.top - safeArea.bottom,
    };
  };

  // A Range rect is the glyph box; CSS centres it on the line box, so a tight
  // line-height is half-leading taken off both sides. Measuring glyph boxes
  // puts every conforming 1.02-line-height heading 4-9px past the safe edge.
  const lines = new Map(
    facts.elements.map((e) => [
      e.idx,
      e.textRects.map((r) =>
        e.lineHeight !== null && e.lineHeight < r.h
          ? { ...r, y: r.y + (r.h - e.lineHeight) / 2, h: e.lineHeight }
          : r,
      ),
    ]),
  );
  // Clipped lines are reported once, as clipped; they paint nowhere else.
  const shown = (e: ProbeElement) =>
    lines
      .get(e.idx)!
      .filter((r) => !e.clip || excess(r, e.clip.rect).length === 0);

  for (const e of facts.elements) {
    // What an element puts on the page: its text, and its own box if it paints
    // one. An unpainted wrapper may span the bleed; nothing of it is visible.
    const visible = [...shown(e), ...(e.paints ? [e.rect] : [])];
    if (!visible.length) continue;
    const over = excess(union(visible), safeBox(e.page));
    if (over.length)
      add(
        'page.safeArea',
        `${e.label} crosses the ${over
          .map(([side, by]) => `${side} safe edge by ${Math.round(by)}px`)
          .join(', ')}`,
        e.page,
      );
  }

  for (const e of facts.elements) {
    if (!e.clip || !e.textRects.length) continue;
    const clipped = e.textRects.length - shown(e).length;
    if (clipped)
      add(
        'render.overflow.clipped',
        `${e.label}: ${clipped} of ${e.textRects.length} lines are cut off by ${e.clip.label}, ` +
          'which hides its overflow',
        e.page,
      );
  }

  const texts = facts.elements.filter((e) => e.textRects.length);
  for (let i = 0; i < texts.length; i++)
    for (let j = i + 1; j < texts.length; j++) {
      const [a, b] = [texts[i], texts[j]];
      if (a.page !== b.page) continue;
      const hit = shown(a).some((ra) =>
        shown(b).some(
          (rb) =>
            area(intersect(ra, rb)) >
            OVERLAP_SHARE * Math.min(area(ra), area(rb)),
        ),
      );
      if (hit)
        add('render.overlap', `${b.label} is painted over ${a.label}`, a.page);
    }

  // --- fonts ----------------------------------------------------------------
  const declared = new Map(
    ds.typography.fonts.map((f) => [f.family.toLowerCase(), f]),
  );
  for (const f of facts.faces)
    if (f.status === 'error')
      add(
        'render.fonts.failed',
        `${f.family} ${f.weight} ${f.style} failed to load`,
      );

  // An outage makes every element fall back; those findings are its symptoms,
  // not the model's mistakes, and a repair cannot fix them.
  const outage = facts.faces.some((f) => f.status === 'error');
  for (const e of outage ? [] : texts) {
    const painted = facts.platformFonts[e.idx] ?? [];
    const wrong = painted.filter((pf) => {
      const d = declared.get(pf.familyName.toLowerCase());
      // A Google family must be the downloaded face; a same-named local install
      // renders differently per machine, which is a fallback by another name.
      return !d || (d.source === 'google' && !pf.isCustomFont);
    });
    if (wrong.length)
      add(
        'render.fonts.fallback',
        `${e.label} painted ${wrong
          .map(
            (w) =>
              `${w.glyphCount} glyph${w.glyphCount === 1 ? '' : 's'} in ${w.familyName}${
                declared.has(w.familyName.toLowerCase())
                  ? ' (a local copy)'
                  : ''
              }`,
          )
          .join(', ')}, not a declared family`,
        e.page,
      );
  }

  // --- colour: the pairing each text element actually used ----------------
  const pairings = new Set(
    ds.palette.pairings.map((p) => `${p.text} on ${p.on}`),
  );
  for (const e of texts) {
    if (e.background === null) continue; // gradient or image: no single pairing
    const fg = tokenOf(e.color);
    const bg = tokenOf(e.background);
    if (!fg || !bg) {
      add(
        'palette.pairings',
        `${e.label} is ${e.color} on ${e.background}; ${!fg ? e.color : e.background} ` +
          'is not an opaque palette token',
        e.page,
      );
      continue;
    }
    if (!pairings.has(`${fg} on ${bg}`)) {
      const ratio = contrast(parseColor(e.color)!, parseColor(e.background)!);
      add(
        'palette.pairings',
        `${e.label} sets ${fg} on ${bg} (${ratio.toFixed(2)}:1), which is not a declared pairing`,
        e.page,
      );
    }
  }

  // --- icons.colors: only knowable after the cascade resolves currentColor --
  for (const e of facts.elements) {
    if (!e.icon) continue;
    const t = tokenOf(e.color);
    if (!t || !ds.icons.colors.includes(t))
      add(
        'icons.colors',
        `${e.label} inherits ${t ?? e.color}; icons may be ${ds.icons.colors.join(' or ')}`,
        e.page,
      );
  }

  // --- egress ---------------------------------------------------------------
  for (const url of facts.blockedRequests)
    add(
      'render.egress',
      `the document requested ${url}, which the session refused; the static check should have rejected it`,
    );

  return out;
}
