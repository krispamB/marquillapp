import type {
  FontFaceFact,
  ProbeElement,
  ProbePage,
  Rect,
} from './render-facts';

/**
 * The elements the probe measures and the font pass queries. Shared, so the
 * probe's `idx` and the CDP node list line up.
 */
export const PROBE_ELEMENT_SELECTOR = 'section.page *';

export interface ProbeResult {
  pages: ProbePage[];
  elements: ProbeElement[];
  faces: FontFaceFact[];
}

/**
 * The in-page measurement (§5.1 step 5). It is serialised and evaluated in the
 * render page over CDP, so it must stay self-contained: no imports, no
 * closures over module scope. It runs with the page's JavaScript disabled,
 * because CDP evaluation is not page script. For the same reason it never
 * passes a callback to a DOM method (`NodeList.forEach`, `FontFaceSet.forEach`):
 * with scripting off, the browser refuses to call it ("no longer runnable").
 *
 * It holds no policy. It reports what the browser laid out, and `judge()`
 * decides what that means.
 */
export async function probeInPage(
  selector: string,
  snippetLength: number,
): Promise<ProbeResult> {
  // Force a layout first: a face starts loading only when layout asks for it,
  // and `fonts.ready` resolves at once if nothing has asked yet.
  void document.body.offsetHeight;
  await document.fonts.ready;

  const box = (r: DOMRect): Rect => ({
    x: r.x + window.scrollX,
    y: r.y + window.scrollY,
    w: r.width,
    h: r.height,
  });
  const label = (el: Element): string => {
    const tag = el.tagName.toLowerCase();
    const cls = Array.from(el.classList)
      .map((c) => `.${c}`)
      .join('');
    const icon = el.getAttribute('data-icon');
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    const quote = text
      ? ` "${text.length > snippetLength ? `${text.slice(0, snippetLength)}…` : text}"`
      : '';
    return `${tag}${cls}${icon ? `[data-icon=${icon}]` : ''}${quote}`;
  };
  /** Alpha of a computed colour: 0 for `transparent`, 1 when none is given. */
  const alphaOf = (c: string): number => {
    if (c === 'transparent') return 0;
    const slash = /\/\s*([\d.]+)(%?)\s*\)$/.exec(c);
    if (slash) return Number(slash[1]) / (slash[2] ? 100 : 1);
    const rgba = /^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/.exec(c);
    return rgba ? Number(rgba[1]) : 1;
  };
  /** Paints its content through opacity, a blend or a filter. */
  const composites = (s: CSSStyleDeclaration) =>
    parseFloat(s.opacity) < 1 ||
    s.mixBlendMode !== 'normal' ||
    s.filter !== 'none';
  const positioned = (s: CSSStyleDeclaration) =>
    s.position === 'absolute' || s.position === 'fixed';

  const pageEls = Array.from(document.querySelectorAll('body > section.page'));
  const pages: ProbePage[] = pageEls.map((p, i) => ({
    index: i + 1,
    role: p.getAttribute('data-role'),
    rect: box(p.getBoundingClientRect()),
  }));

  /** The element and its ancestors, up to and excluding the page. */
  const chain = (el: Element): Element[] => {
    const out: Element[] = [];
    const page = el.closest('section.page');
    for (let n: Element | null = el; n && n !== page; n = n.parentElement)
      out.push(n);
    return out;
  };
  const throughCompositing = (el: Element) =>
    chain(el).some((n) => composites(getComputedStyle(n)));

  /**
   * What a style paints behind text: `undefined` for nothing, `null` for
   * something with no single colour (a gradient, an image, a translucent
   * colour, or anything composited), or an opaque computed colour.
   */
  const paintOf = (
    s: CSSStyleDeclaration,
    owner: Element,
  ): string | null | undefined => {
    const image = s.backgroundImage !== 'none';
    const alpha = alphaOf(s.backgroundColor);
    if (!image && alpha === 0) return undefined;
    if (image || alpha < 1 || composites(s) || throughCompositing(owner))
      return null;
    return s.backgroundColor;
  };

  /**
   * The box of an absolutely positioned `::before` or `::after`, from its
   * containing block's padding box and its resolved offsets. `null` when the
   * offsets do not resolve to px.
   */
  const pseudoBox = (owner: Element, s: CSSStyleDeclaration): Rect | null => {
    let cb: Element | null = owner;
    for (; cb; cb = cb.parentElement) {
      const c = getComputedStyle(cb);
      if (
        (s.position === 'absolute' && c.position !== 'static') ||
        c.transform !== 'none' ||
        c.filter !== 'none' ||
        /paint|layout|strict|content/.test(c.contain)
      )
        break;
    }
    if (!cb) return null;
    const r = cb.getBoundingClientRect();
    const [left, top, w, h, ml, mt] = [
      s.left,
      s.top,
      s.width,
      s.height,
      s.marginLeft,
      s.marginTop,
    ].map((v) => (/^-?[\d.]+px$/.test(v) ? parseFloat(v) : NaN));
    if ([left, top, w, h].some((n) => Number.isNaN(n))) return null;
    return {
      x: r.x + window.scrollX + cb.clientLeft + left + (ml || 0),
      y: r.y + window.scrollY + cb.clientTop + top + (mt || 0),
      w,
      h,
    };
  };

  /**
   * The effective background under the centre of one line of an element's
   * text: hit-test the point, then walk down the paint stack from the element
   * (what paints over the text is occlusion, not background). A positioned
   * `::before`/`::after` under the point counts, since a full-page backdrop
   * is usually one.
   */
  const backgroundAt = (el: Element, line: Rect): string | null => {
    const cx = line.x + line.w / 2;
    const cy = line.y + line.h / 2;
    window.scrollTo(0, Math.max(0, cy - window.innerHeight / 2));
    const vx = cx - window.scrollX;
    const vy = cy - window.scrollY;
    if (vx < 0 || vy < 0 || vx >= window.innerWidth || vy >= window.innerHeight)
      return null;
    const stack = document.elementsFromPoint(vx, vy);
    const at = stack.indexOf(el);
    const below =
      at >= 0 ? stack.slice(at) : stack.filter((n) => !el.contains(n));
    for (const n of below) {
      for (const pseudo of ['::after', '::before']) {
        const s = getComputedStyle(n, pseudo);
        if (s.content === 'none' || s.content === 'normal' || !positioned(s))
          continue;
        const r = pseudoBox(n, s);
        if (!r || cx < r.x || cx > r.x + r.w || cy < r.y || cy > r.y + r.h)
          continue;
        const paint = paintOf(s, n);
        if (paint !== undefined) return paint;
      }
      const paint = paintOf(getComputedStyle(n), n);
      if (paint !== undefined) return paint;
    }
    return 'rgb(255, 255, 255)'; // the canvas
  };

  const elements: ProbeElement[] = [];
  Array.from(document.querySelectorAll(selector)).forEach((el, idx) => {
    const tag = el.tagName.toLowerCase();
    // An icon's paths come from the catalog; they are not content.
    if (tag !== 'svg' && el.closest('svg')) return;
    const page = el.closest('section.page');
    const cs = getComputedStyle(el);

    const textRects: Rect[] = [];
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim())
        continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of Array.from(range.getClientRects()))
        if (r.width > 0 && r.height > 0) textRects.push(box(r));
    }

    const paints =
      tag === 'svg' ||
      tag === 'hr' ||
      alphaOf(cs.backgroundColor) > 0 ||
      cs.backgroundImage !== 'none' ||
      cs.boxShadow !== 'none' ||
      ['top', 'right', 'bottom', 'left'].some(
        (side) =>
          parseFloat(cs.getPropertyValue(`border-${side}-width`)) > 0 &&
          cs.getPropertyValue(`border-${side}-style`) !== 'none',
      );

    // The element itself counts: `height: 50px; overflow: hidden` on a <p>
    // hides that <p>'s own lines.
    let clip: ProbeElement['clip'] = null;
    for (const n of chain(el)) {
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
      page: page ? pageEls.indexOf(page) + 1 : 0,
      label: label(el),
      tag,
      rect: box(el.getBoundingClientRect()),
      textRects,
      color: cs.color,
      translucent: alphaOf(cs.color) < 1 || throughCompositing(el),
      backgrounds: textRects.map((r) => backgroundAt(el, r)),
      paints,
      placed: chain(el).some((n) => positioned(getComputedStyle(n))),
      clip,
      icon: tag === 'svg' ? el.getAttribute('data-icon') : null,
      lineHeight: cs.lineHeight === 'normal' ? null : parseFloat(cs.lineHeight),
    });
  });
  window.scrollTo(0, 0);

  const faces: FontFaceFact[] = Array.from(document.fonts).map((f) => ({
    family: f.family.replace(/^["']|["']$/g, ''),
    weight: f.weight,
    style: f.style,
    status: f.status,
  }));

  return { pages, elements, faces };
}
