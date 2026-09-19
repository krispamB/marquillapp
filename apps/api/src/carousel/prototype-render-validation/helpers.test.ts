/** PROTOTYPE tests (issue #163) for the pure helpers around the render pass. */
import { beforeAll, describe, expect, test } from 'bun:test';
import {
  parseDesignSystem,
  type DesignSystem,
} from '../prototype-design-system/contract';
import { assemble, fontHref, frameCss, IconInliningError } from './assemble';
import { boundForModel, remedyOf } from './diagnostics';
import { countPdfPages } from './pdf';
import type { Violation } from './types';

let ds: DesignSystem;
beforeAll(async () => {
  const parsed = parseDesignSystem(
    await Bun.file(
      `${import.meta.dir}/../prototype-design-system/editorial-serif.ds.yaml`,
    ).text(),
  );
  if (!parsed.success) throw parsed.error;
  ds = parsed.data;
});

describe('countPdfPages', () => {
  const pdf = (pages: number, count = pages) =>
    new TextEncoder().encode(
      `%PDF-1.4\n1 0 obj << /Type /Pages /Count ${count} /Kids [] >> endobj\n` +
        Array.from(
          { length: pages },
          (_, i) => `${i + 2} 0 obj << /Type /Page /Parent 1 0 R >> endobj\n`,
        ).join(''),
    );

  test('reads the root page count', () => {
    expect(countPdfPages(pdf(4))).toBe(4);
  });

  test('refuses a page tree it cannot see', () => {
    expect(() => countPdfPages(pdf(0))).toThrow('unreadable');
    expect(() => countPdfPages(pdf(3, 4))).toThrow('unreadable');
  });
});

describe('boundForModel', () => {
  test('only findings the model can repair reach it', () => {
    const text = boundForModel([
      { code: 'page.safeArea', detail: 'too low', page: 2 },
      { code: 'render.fonts.failed', detail: 'Inter 400 failed' },
      { code: 'render.egress', detail: 'requested x' },
      { code: 'render.timeout', detail: 'slow' },
    ]);
    expect(text).toBe('- [page.safeArea] page 2: too low');
  });

  test('every code has a remedy', () => {
    for (const code of [
      'render.pages.blank',
      'render.fonts.fallback',
      'icons.colors',
    ])
      expect(remedyOf(code)).toBe('repair');
    expect(remedyOf('render.fonts.failed')).toBe('retry');
    expect(remedyOf('render.egress')).toBe('defect');
  });

  const v = (code: string, n: number): Violation[] =>
    Array.from({ length: n }, (_, i) => ({
      code,
      detail: `finding ${i}`,
      page: 1,
    }));

  test('at most 3 per code, with a count of the rest', () => {
    const text = boundForModel(v('page.safeArea', 25));
    expect(text.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(3);
    expect(text).toContain('(and 22 more [page.safeArea])');
  });

  test('at most 40 in total, and says what it dropped', () => {
    const many = Array.from({ length: 15 }, (_, i) => v(`code.${i}`, 3)).flat();
    const text = boundForModel(many);
    expect(text.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(40);
    expect(text).toContain('(and 2 more [code.13])');
    expect(text).toContain('(and 3 more findings under other codes)');
  });
});

describe('assemble', () => {
  const candidate = `<!doctype html><html><head><meta charset="utf-8"><style>:root{--ds-paper:#faf7f2}</style></head>
<body><section class="page" data-role="cover"><p><svg data-icon="arrow-right" data-size="32"></svg> Go</p></section></body></html>`;

  test('the frame owns geometry from the definition and nothing else', () => {
    const css = frameCss(ds);
    expect(css).toContain('width: 1080px; height: 1350px');
    expect(css).toContain('padding: 96px 96px 96px 96px');
    expect(css).toContain('background: var(--ds-paper)');
    expect(css).toContain('.page:last-child { break-after: auto; }');
    expect(css).toContain('contain: strict');
    expect(css).not.toContain('display');
  });

  test('fonts come from the definition and the allowlist, blocking', () => {
    expect(fontHref(ds)).toBe(
      'https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,600;0,700;1,600;1,700&family=Inter:wght@400;600&display=block',
    );
  });

  test('frame and font link land at the end of <head>; icons are inlined', () => {
    const html = assemble(ds, candidate);
    expect(html.indexOf('data-frame')).toBeGreaterThan(
      html.indexOf('--ds-paper'),
    );
    expect(html).toContain('fonts.googleapis.com');
    expect(html).toContain('<path d="M5 12h14"/>');
    expect(html).toContain('width="32" height="32"');
    expect(html).toContain('stroke="currentColor"');
  });

  test('an icon the catalog lacks is terminal', () => {
    expect(() =>
      assemble(ds, candidate.replace('arrow-right', 'rocket')),
    ).toThrow(IconInliningError);
  });
});
