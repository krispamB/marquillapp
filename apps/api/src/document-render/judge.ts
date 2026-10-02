import type { DesignSystemDefinition } from '../design-system/design-system-definition';
import type { Violation } from '../document-source/violation';
import {
  RENDER_OVERLAP_SHARE,
  RENDER_TOLERANCE_PX,
} from './document-render.constants';
import type { ProbeElement, Rect, RenderFacts } from './render-facts';
import type { RenderViolationCode } from './render-remedy';

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const parseColor = (css: string): Rgba | null => {
  const m = /^rgba?\(([^)]+)\)$/.exec(css.trim());
  if (!m) return null;
  const parts = m[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
  const [r, g, b, a = 1] = parts;
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

type Side = 'top' | 'right' | 'bottom' | 'left';

/** How far `inner` pokes out of `outer` on each side, beyond the tolerance. */
const excess = (inner: Rect, outer: Rect): [Side, number][] =>
  (
    [
      ['top', outer.y - inner.y],
      ['right', inner.x + inner.w - (outer.x + outer.w)],
      ['bottom', inner.y + inner.h - (outer.y + outer.h)],
      ['left', outer.x - inner.x],
    ] as [Side, number][]
  ).filter(([, by]) => by > RENDER_TOLERANCE_PX);

/**
 * A Range rect is the glyph box (ascent + descent). CSS centres it on the line
 * box, so a line box is the glyph box with half the leading taken off each
 * side. With a tight `line-height` the leading is negative and the line box is
 * shorter than the glyph box; measuring glyph boxes would put every conforming
 * tight heading at the safe edge a few px past it. A loose `line-height` adds
 * only blank space, so the glyph box is what paints.
 */
export function lineBox(glyphBox: Rect, lineHeight: number | null): Rect {
  if (lineHeight === null || lineHeight >= glyphBox.h) return glyphBox;
  return {
    ...glyphBox,
    y: glyphBox.y + (glyphBox.h - lineHeight) / 2,
    h: lineHeight,
  };
}

/**
 * The declared font a platform font belongs to. A web font reports the name
 * in its own file, which for a variable or multi-style face carries the
 * instance after the family (`Manrope ExtraLight`, `Bodoni Moda 11pt`), so a
 * name matches a family exactly or as a word prefix; the longest family wins.
 */
function declaredFont(
  definition: DesignSystemDefinition,
  platformName: string,
): DesignSystemDefinition['typography']['fonts'][number] | undefined {
  const name = platformName.toLowerCase();
  return definition.typography.fonts
    .filter((f) => {
      const family = f.family.toLowerCase();
      return name === family || name.startsWith(`${family} `);
    })
    .sort((a, b) => b.family.length - a.family.length)[0];
}

/**
 * Render facts in, violations out (§5.2). Pure: the probe measures and the
 * judge decides. Codes follow §4.4's namespaces: a finding a Design System key
 * owns keeps its key path (`page.safeArea`, `palette.pairings`,
 * `icons.colors`), and a finding about the render itself is `render.*`.
 *
 * Render findings have no `line`: a laid-out element has no source position.
 * Instead, an element finding's `detail` names the page, the element (tag,
 * classes and a text snippet) and the distance.
 */
export function judge(
  definition: DesignSystemDefinition,
  facts: RenderFacts,
): Violation[] {
  const out: Violation[] = [];
  const add = (code: RenderViolationCode, detail: string, page?: number) =>
    out.push(
      page === undefined
        ? { code, detail }
        : { code, detail: `page ${page}: ${detail}`, page },
    );

  // Egress is a checker defect whatever else happened, so it is always judged.
  const egress = () => {
    for (const url of facts.refusedRequests)
      add(
        'render.egress',
        `the document requested ${url}, which the session refused; the static check should have rejected it`,
      );
  };

  // A render that never settled measured nothing trustworthy.
  if (facts.timedOut) {
    add(
      'render.timeout',
      'the document did not finish rendering within the session deadline',
    );
    egress();
    return out;
  }

  const { width, height, safeArea } = definition.page;

  // A token is looked up by the definition's hex, never the document's :root:
  // the definition is the authority on what a token is.
  const tokenOf = (css: string): string | null => {
    const c = parseColor(css);
    if (!c || c.a !== 1) return null;
    const token = definition.palette.tokens.find((t) => {
      const h = hexToRgb(t.hex);
      return h.r === c.r && h.g === c.g && h.b === c.b;
    });
    return token?.name ?? null;
  };

  // --- pages: geometry, pagination, blankness ------------------------------
  // Absolute, not relative to the previous page: the PDF slices the canvas at
  // multiples of the page height, so a page 48px down the canvas prints 48px
  // of its predecessor at the top of every sheet.
  facts.pages.forEach((p, i) => {
    const { rect } = p;
    const expectedY = i * height;
    if (
      Math.abs(rect.w - width) > RENDER_TOLERANCE_PX ||
      Math.abs(rect.h - height) > RENDER_TOLERANCE_PX ||
      Math.abs(rect.x) > RENDER_TOLERANCE_PX ||
      Math.abs(rect.y - expectedY) > RENDER_TOLERANCE_PX
    )
      add(
        'render.pages.geometry',
        `the page box is ${Math.round(rect.w)}x${Math.round(rect.h)} at x=${Math.round(rect.x)}, y=${Math.round(rect.y)}; ` +
          `it must be ${width}x${height} at x=0, y=${expectedY}`,
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
    if (!shows) add('render.pages.blank', 'shows no text and no icon', p.index);
  }

  // --- content geometry: safe area, clipping, overlap ----------------------
  const pageRects = new Map(facts.pages.map((p) => [p.index, p.rect]));
  const safeBox = (page: number): Rect | undefined => {
    const r = pageRects.get(page);
    return (
      r && {
        x: r.x + safeArea.left,
        y: r.y + safeArea.top,
        w: r.w - safeArea.left - safeArea.right,
        h: r.h - safeArea.top - safeArea.bottom,
      }
    );
  };

  const lines = new Map(
    facts.elements.map((e) => [
      e.idx,
      e.textRects.map((r) => lineBox(r, e.lineHeight)),
    ]),
  );
  // A clipped line is reported once, as clipped: it paints nowhere else.
  const shown = (e: ProbeElement) =>
    (lines.get(e.idx) ?? []).filter(
      (r) => !e.clip || excess(r, e.clip.rect).length === 0,
    );

  for (const e of facts.elements) {
    // What an element puts on the page: its text, and its own box if it
    // paints one. An unpainted wrapper may span the bleed invisibly.
    const visible = [...shown(e), ...(e.paints ? [e.rect] : [])];
    const safe = safeBox(e.page);
    const page = pageRects.get(e.page);
    if (!visible.length || !safe || !page) continue;
    if (e.placed) {
      // An absolutely positioned element was placed, not laid out: a bleed,
      // a cropped numeral, a frame or a callout, which the seed Design
      // Systems compose with on purpose. It only has to stay on its page.
      const text = shown(e);
      if (text.length && text.every((r) => area(intersect(r, page)) === 0))
        add(
          'page.safeArea',
          `${e.label} is placed entirely off the page`,
          e.page,
        );
      continue;
    }
    const over = excess(union(visible), safe);
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

  const texts = facts.elements.filter((e) => e.textRects.length > 0);
  for (let i = 0; i < texts.length; i++)
    for (let j = i + 1; j < texts.length; j++) {
      const [a, b] = [texts[i], texts[j]];
      if (a.page !== b.page) continue;
      let worst = 0;
      for (const ra of shown(a))
        for (const rb of shown(b)) {
          const hit = intersect(ra, rb);
          if (area(hit) > RENDER_OVERLAP_SHARE * Math.min(area(ra), area(rb)))
            worst = Math.max(worst, Math.min(hit.w, hit.h));
        }
      if (worst > 0)
        add(
          'render.overlap',
          `${b.label} is painted over ${a.label} by ${Math.round(worst)}px`,
          a.page,
        );
    }

  // --- fonts ----------------------------------------------------------------
  const failed = facts.faces.filter((f) => f.status === 'error');
  for (const f of failed)
    add(
      'render.fonts.failed',
      `${f.family} ${f.weight} ${f.style} failed to load`,
    );

  // An outage makes every element fall back. Those fallbacks are its
  // symptoms, not the model's mistakes, and a Repair cannot fix them.
  for (const e of failed.length ? [] : texts) {
    const painted = facts.platformFonts[e.idx] ?? [];
    const wrong = painted.filter((pf) => {
      const font = declaredFont(definition, pf.familyName);
      // A Google family must be the downloaded face; a same-named local
      // install renders differently per machine, a fallback by another name.
      return !font || (font.source === 'google' && !pf.isCustomFont);
    });
    if (wrong.length)
      add(
        'render.fonts.fallback',
        `${e.label} painted ${wrong
          .map(
            (w) =>
              `${w.glyphCount} glyph${w.glyphCount === 1 ? '' : 's'} in ${w.familyName}${
                declaredFont(definition, w.familyName) ? ' (a local copy)' : ''
              }`,
          )
          .join(', ')}, not a declared family`,
        e.page,
      );
  }

  // --- colour: the pairing each text element actually used -----------------
  const pairings = new Set(
    definition.palette.pairings.map((p) => `${p.text} on ${p.on}`),
  );
  for (const e of texts) {
    // Translucent text has no single colour to pair; a known blind spot.
    if (e.translucent) continue;
    const fg = tokenOf(e.color);
    // Each distinct background under a line the element shows. A line over
    // a gradient, an image or a composited paint (`null`) is skipped.
    const visibleLines = new Set(shown(e));
    const backgrounds = new Set(
      (lines.get(e.idx) ?? []).flatMap((line, i) =>
        visibleLines.has(line) && e.backgrounds[i] ? [e.backgrounds[i]] : [],
      ),
    );
    for (const background of backgrounds) {
      const bg = tokenOf(background);
      if (!fg || !bg) {
        add(
          'palette.pairings',
          `${e.label} is ${e.color} on ${background}; ${fg ? background : e.color} ` +
            'is not a palette token',
          e.page,
        );
      } else if (!pairings.has(`${fg} on ${bg}`)) {
        const ratio = contrast(parseColor(e.color)!, parseColor(background)!);
        add(
          'palette.pairings',
          `${e.label} sets ${fg} on ${bg} (${ratio.toFixed(2)}:1), which is not a declared pairing`,
          e.page,
        );
      }
    }
  }

  // --- icons: only knowable once the cascade resolves currentColor ---------
  for (const e of facts.elements) {
    if (!e.icon) continue;
    const token = tokenOf(e.color);
    if (!token || !definition.icons.colors.includes(token))
      add(
        'icons.colors',
        `${e.label} inherits ${token ?? e.color}; icons may be ${definition.icons.colors.join(' or ')}`,
        e.page,
      );
  }

  egress();
  return out;
}
