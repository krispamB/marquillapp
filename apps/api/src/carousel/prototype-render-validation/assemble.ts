/**
 * PROTOTYPE — Candidate Source + definition -> Document Source. Throwaway
 * (issue #163; the contract is #162's).
 *
 * Adds exactly the three backend-derived parts and nothing else: the frame
 * stylesheet, the Google Fonts <link>, and icon path data. The input has already
 * passed the static checker, which is why string insertion is tolerable here;
 * production would serialise through parse5 like the checker parses.
 */
import type { DesignSystem } from '../prototype-design-system/contract';
import { DESIGN_SYSTEM_FONT_ALLOWLIST } from './font-allowlist';
import { ICON_CATALOG } from './icons';

/** Geometry and pagination only — never `display`, never colour or type. */
export function frameCss(ds: DesignSystem): string {
  const { width, height, safeArea: s, background } = ds.page;
  return [
    'html, body { margin: 0; padding: 0; }',
    // `contain: strict` makes each page the containing block for positioned
    // descendants and keeps print fragmentation from carrying them to another
    // sheet. Without it `top: 200px` on page 4 paints onto page 1, and
    // `top: 6000px` adds PDF pages; `overflow: hidden`, `overflow: clip`,
    // `position: relative` and `contain: paint` each leave the second open.
    `.page { contain: strict; width: ${width}px; height: ${height}px; box-sizing: border-box; ` +
      `padding: ${s.top}px ${s.right}px ${s.bottom}px ${s.left}px; ` +
      `background: var(--ds-${background}); overflow: hidden; overflow-wrap: break-word; ` +
      'break-after: page; }',
    '.page:last-child { break-after: auto; }',
  ].join('\n');
}

/** `display=block`: a PDF is one frame, so a swap-period fallback must never paint. */
export function fontHref(ds: DesignSystem): string | null {
  const families = ds.typography.fonts
    .filter(
      (f) =>
        f.source === 'google' && DESIGN_SYSTEM_FONT_ALLOWLIST.has(f.family),
    )
    .map((f) => {
      const name = f.family.replace(/ /g, '+');
      const weights = [...f.weights].sort((a, b) => a - b);
      if (!f.styles.includes('italic'))
        return `family=${name}:wght@${weights.join(';')}`;
      const axes = f.styles
        .flatMap((st) => weights.map((w) => `${st === 'italic' ? 1 : 0},${w}`))
        .sort();
      return `family=${name}:ital,wght@${axes.join(';')}`;
    });
  return families.length
    ? `https://fonts.googleapis.com/css2?${families.join('&')}&display=block`
    : null;
}

export class IconInliningError extends Error {}

export function assemble(ds: DesignSystem, candidate: string): string {
  const href = fontHref(ds);
  const head =
    (href ? `<link rel="stylesheet" href="${href}">\n` : '') +
    `<style data-frame>\n${frameCss(ds)}\n</style>\n`;
  // The frame goes last in <head> so it wins the cascade at equal specificity;
  // a model-authored `.page` rule is already a static violation.
  let html = candidate.replace(/<\/head>/i, `${head}</head>`);

  html = html.replace(/<svg\b([^>]*)>\s*<\/svg>/gi, (_, attrs: string) => {
    const name = attrs.match(/data-icon="([^"]+)"/)?.[1];
    const size = attrs.match(/data-size="(\d+)"/)?.[1];
    const inner = name ? ICON_CATALOG[name] : undefined;
    // Terminal, never silent: an empty <svg> is an invisible hole in a published PDF.
    if (!inner || !size)
      throw new IconInliningError(`cannot inline icon "${name}"`);
    return (
      `<svg data-icon="${name}" data-size="${size}" xmlns="http://www.w3.org/2000/svg" ` +
      `viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" ` +
      `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ` +
      `focusable="false">${inner}</svg>`
    );
  });

  if (/<svg\b[^>]*>\s*<\/svg>/i.test(html))
    throw new IconInliningError('an icon placeholder survived assembly');
  return html;
}
