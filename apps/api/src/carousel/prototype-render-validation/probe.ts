/**
 * PROTOTYPE — the in-page measurement. Throwaway (issue #163).
 *
 * This function is serialised and evaluated inside the render page over CDP. It
 * must stay self-contained (no imports, no closures) and it holds no policy: it
 * reports what the browser laid out, and `judge()` decides what that means.
 *
 * It runs with the page's JavaScript disabled. CDP `Runtime.evaluate` is not
 * page script, so the probe still runs while any <script> in the document never
 * does — the prototype proves both (menu item 7).
 */
import type { FontFaceFact, ProbeElement, ProbePage } from './types';

/** Shared with the CDP font pass so element indices line up. */
export const ELEMENT_SELECTOR = 'section.page *';

export type ProbeResult = {
  pages: ProbePage[];
  elements: ProbeElement[];
  faces: FontFaceFact[];
  scriptRan: boolean;
};

export async function probeInPage(selector: string): Promise<ProbeResult> {
  // Force a layout first: a face starts loading only when layout asks for it,
  // and `fonts.ready` resolves immediately if nothing has asked yet.
  void document.body.offsetHeight;
  await document.fonts.ready;

  const box = (r: DOMRect) => ({
    x: r.x + window.scrollX,
    y: r.y + window.scrollY,
    w: r.width,
    h: r.height,
  });
  const label = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    const cls = [...el.classList].map((c) => `.${c}`).join('');
    const icon = el.getAttribute('data-icon');
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    const quote = text
      ? ` "${text.length > 32 ? `${text.slice(0, 32)}…` : text}"`
      : '';
    return `${tag}${cls}${icon ? `[data-icon=${icon}]` : ''}${quote}`;
  };
  const opaque = (c: string) =>
    !/^rgba\(.*,\s*0\)$/.test(c) && c !== 'transparent';

  const pageEls = [...document.querySelectorAll('body > section.page')];
  const pages = pageEls.map((p, i) => ({
    index: i + 1,
    role: p.getAttribute('data-role'),
    rect: box(p.getBoundingClientRect()),
  }));

  const elements: ProbeElement[] = [];
  [...document.querySelectorAll(selector)].forEach((el, idx) => {
    // SVG internals are icon paths from the catalog, not content.
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') return;
    const page = el.closest('section.page');
    const cs = getComputedStyle(el);

    const textRects: ProbeElement['textRects'] = [];
    for (const node of el.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim())
        continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects())
        if (r.width > 0 && r.height > 0) textRects.push(box(r));
    }

    let background: string | null = 'rgb(255, 255, 255)'; // the canvas
    for (let n: Element | null = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.backgroundImage !== 'none') {
        background = null;
        break;
      }
      if (opaque(s.backgroundColor)) {
        background = s.backgroundColor;
        break;
      }
    }

    const tag = el.tagName.toLowerCase();
    const paints =
      tag === 'svg' ||
      tag === 'hr' ||
      opaque(cs.backgroundColor) ||
      cs.backgroundImage !== 'none' ||
      cs.boxShadow !== 'none' ||
      (['Top', 'Right', 'Bottom', 'Left'] as const).some(
        (side) =>
          parseFloat(
            cs.getPropertyValue(`border-${side.toLowerCase()}-width`),
          ) > 0 &&
          cs.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none',
      );

    // The element itself counts: `height: 50px; overflow: hidden` on a <p>
    // hides that <p>'s own lines.
    let clip: ProbeElement['clip'] = null;
    for (let n: Element | null = el; n && n !== page; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
        const r = n.getBoundingClientRect();
        clip = {
          label: label(n),
          rect: {
            x: r.x + n.clientLeft + window.scrollX,
            y: r.y + n.clientTop + window.scrollY,
            w: n.clientWidth,
            h: n.clientHeight,
          },
        };
        break;
      }
    }

    elements.push({
      idx,
      page: pageEls.indexOf(page as Element) + 1,
      label: label(el),
      tag,
      rect: box(el.getBoundingClientRect()),
      textRects,
      color: cs.color,
      background,
      paints,
      clip,
      icon: tag === 'svg' ? el.getAttribute('data-icon') : null,
      lineHeight: cs.lineHeight === 'normal' ? null : parseFloat(cs.lineHeight),
    });
  });

  const faces = [...document.fonts].map((f) => ({
    family: f.family.replace(/^["']|["']$/g, ''),
    weight: f.weight,
    style: f.style,
    status: f.status,
  }));

  return {
    pages,
    elements,
    faces,
    scriptRan: document.documentElement.hasAttribute('data-script-ran'),
  };
}
