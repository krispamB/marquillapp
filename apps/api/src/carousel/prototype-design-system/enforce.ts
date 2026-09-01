/**
 * PROTOTYPE — what the backend can actually reject. Throwaway (issue #160).
 *
 * Static text checks only. This is deliberately dumber than the real thing:
 * #162 owns the Document Source envelope and sanitisation, #163 owns the
 * Browserless geometry pass. The point here is only to show which Design System
 * keys have teeth without a browser, and which need one.
 *
 * Envelope assumed for the prototype: one <style> block, one <section
 * class="page"> per page, icons as <svg data-icon="name" data-size="24">.
 */
import type { DesignSystem } from './contract';

export type Violation = { rule: string; detail: string; page?: number };

const cssOf = (src: string) =>
  [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((m) => m[1])
    .join('\n');
const pagesOf = (src: string) =>
  [
    ...src.matchAll(
      /<section[^>]*class="[^"]*\bpage\b[^"]*"[^>]*>([\s\S]*?)<\/section>/gi,
    ),
  ].map((m) => m[0]);
const rootBlock = (css: string) =>
  (css.match(/:root\s*\{([\s\S]*?)\}/) ?? [, ''])[1] ?? '';

export function enforce(
  ds: DesignSystem,
  source: string,
  opts = { strict: false },
): Violation[] {
  const v: Violation[] = [];
  const add = (rule: string, detail: string, page?: number) =>
    v.push({ rule, detail, page });

  const css = cssOf(source);
  const pages = pagesOf(source);
  const hexes = new Set(ds.palette.tokens.map((t) => t.hex.toLowerCase()));
  const tokenNames = new Set(ds.palette.tokens.map((t) => t.name));
  const sizes = new Set(ds.typography.scale.map((s) => s.px));
  const space = new Set(ds.spacing.scale);

  // page.pages — page count
  if (pages.length < ds.page.pages.min || pages.length > ds.page.pages.max)
    add(
      'page.pages',
      `${pages.length} pages, allowed ${ds.page.pages.min}-${ds.page.pages.max}`,
    );

  // page.width / page.height — the declared page box
  const box = css.match(/\.page\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  const declared = (prop: string) =>
    Number(box.match(new RegExp(`(?<![-\\w])${prop}\\s*:\\s*(\\d+)px`))?.[1]);
  if (
    declared('width') !== ds.page.width ||
    declared('height') !== ds.page.height
  )
    add(
      'page.width/height',
      `.page declares ${declared('width')}x${declared('height')}, contract is ${ds.page.width}x${ds.page.height}`,
    );

  // palette.rules.externalColors — every colour literal resolves to a token
  const outsideRoot = css.replace(/:root\s*\{[\s\S]*?\}/, '');
  for (const m of css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    const hex = m[0].toLowerCase();
    if (!hexes.has(hex))
      add(
        'palette.rules.externalColors',
        `colour ${m[0]} is not a palette token`,
      );
  }
  for (const m of outsideRoot.matchAll(/\b(rgba?|hsla?)\(/g))
    add(
      'palette.rules.externalColors',
      `${m[1]}() colour bypasses the palette tokens`,
    );
  if (opts.strict) {
    for (const m of outsideRoot.matchAll(/#[0-9a-fA-F]{3,8}\b/g))
      add(
        'palette (strict)',
        `${m[0]} used directly; strict mode allows only var(--ds-<token>)`,
      );
    for (const m of css.matchAll(/var\(\s*--ds-([a-zA-Z0-9]+)\s*\)/g))
      if (!tokenNames.has(m[1]))
        add('palette (strict)', `var(--ds-${m[1]}) resolves to no token`);
  }

  // typography.fonts — declared families and the Google Fonts request
  const families = ds.typography.fonts.map((f) => f.family.toLowerCase());
  for (const m of css.matchAll(/font-family\s*:\s*([^;}]+)/g)) {
    const first = m[1]
      .split(',')[0]
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .toLowerCase();
    if (!families.includes(first))
      add(
        'typography.fonts',
        `font-family "${first}" is not in the design system`,
      );
  }
  for (const m of source.matchAll(
    /fonts\.googleapis\.com\/css2\?([^"'\s>]+)/g,
  )) {
    for (const fam of m[1].matchAll(/family=([^&:]+)/g)) {
      const name = decodeURIComponent(fam[1]).replace(/\+/g, ' ').toLowerCase();
      const known = ds.typography.fonts.find(
        (f) => f.source === 'google' && f.family.toLowerCase() === name,
      );
      if (!known)
        add(
          'typography.fonts',
          `Google Fonts request for "${name}", which the system does not declare`,
        );
    }
  }

  // typography.rules.sizes / minPx
  for (const m of css.matchAll(/font-size\s*:\s*([^;}]+)/g)) {
    const raw = m[1].trim();
    const n = Number(raw.match(/^(\d+(?:\.\d+)?)px$/)?.[1]);
    if (Number.isNaN(n))
      add(
        'typography.rules.sizes',
        `font-size "${raw}" is not a px value from the scale`,
      );
    else if (!sizes.has(n))
      add(
        'typography.rules.sizes',
        `font-size ${n}px is not a step in the type scale`,
      );
    else if (n < ds.typography.rules.minPx)
      add('typography.rules.minPx', `font-size ${n}px is below the floor`);
  }

  // typography.rules.transforms
  for (const m of css.matchAll(/text-transform\s*:\s*([^;}]+)/g)) {
    const t = m[1].trim();
    if (!(ds.typography.rules.transforms as string[]).includes(t))
      add('typography.rules.transforms', `text-transform: ${t} is not allowed`);
  }

  // spacing.rules.values
  const spaceProps =
    /\b(margin|padding|gap|row-gap|column-gap)(-top|-right|-bottom|-left)?\s*:\s*([^;}]+)/g;
  for (const m of css.matchAll(spaceProps)) {
    for (const part of m[3].trim().split(/\s+/)) {
      if (part === '0' || part === 'auto') continue;
      const n = Number(part.match(/^(\d+(?:\.\d+)?)px$/)?.[1]);
      if (Number.isNaN(n))
        add(
          'spacing.rules.values',
          `${m[1]}: "${part}" is not a px value from the scale`,
        );
      else if (!space.has(n))
        add(
          'spacing.rules.values',
          `${m[1]}: ${n}px is not a step in the spacing scale`,
        );
    }
  }

  // icons
  pages.forEach((page, i) => {
    const icons = [...page.matchAll(/data-icon="([^"]+)"/g)].map((m) => m[1]);
    if (icons.length > ds.icons.rules.maxPerPage)
      add(
        'icons.rules.maxPerPage',
        `${icons.length} icons, max ${ds.icons.rules.maxPerPage}`,
        i + 1,
      );
    for (const name of icons)
      if (!ds.icons.allowed.includes(name))
        add(
          'icons.allowed',
          `icon "${name}" is not in the catalog subset`,
          i + 1,
        );
    for (const m of page.matchAll(/data-size="(\d+)"/g))
      if (!ds.icons.sizes.includes(Number(m[1])))
        add('icons.sizes', `icon size ${m[1]} is not an allowed size`, i + 1);
  });

  return v;
}

/** Definition-time check: do the declared pairings clear the contrast floor? */
export function contrastReport(ds: DesignSystem) {
  const hex = (name: string) =>
    ds.palette.tokens.find((t) => t.name === name)!.hex;
  const lum = (h: string) => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const [r, g, b] = c.map((x) =>
      x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  return ds.palette.pairings.map((p) => {
    const [a, b] = [lum(hex(p.text)), lum(hex(p.on))].sort((x, y) => y - x);
    const ratio = (a + 0.05) / (b + 0.05);
    return {
      pair: `${p.text} on ${p.on}`,
      ratio,
      pass: ratio >= ds.palette.rules.minContrastRatio,
    };
  });
}
