/**
 * PROTOTYPE tests (issue #163). `bun test src/carousel/prototype-render-validation`
 * — `.test.ts`, not `.spec.ts`, so Jest never loads Bun-only code.
 */
import { beforeAll, describe, expect, test } from 'bun:test';
import {
  parseDesignSystem,
  type DesignSystem,
} from '../prototype-design-system/contract';
import { judge } from './judge';
import type { ProbeElement, RenderFacts } from './types';

let ds: DesignSystem;
beforeAll(async () => {
  const text = await Bun.file(
    `${import.meta.dir}/../prototype-design-system/editorial-serif.ds.yaml`,
  ).text();
  const parsed = parseDesignSystem(text);
  if (!parsed.success) throw parsed.error;
  ds = parsed.data;
});

// editorial-serif: 1080x1350, safe area 96 all round, paper #faf7f2, ink #14110f,
// accent #9c3412, accentInk #fdf6f2, muted #5f574e.
const PAPER = 'rgb(250, 247, 242)';
const INK = 'rgb(20, 17, 15)';
const ACCENT = 'rgb(156, 52, 18)';
const MUTED = 'rgb(95, 87, 78)';

const pageRect = (i: number) => ({ x: 0, y: (i - 1) * 1350, w: 1080, h: 1350 });

const el = (over: Partial<ProbeElement> = {}): ProbeElement => ({
  idx: 0,
  page: 1,
  label: 'p.body "Some text"',
  tag: 'p',
  rect: { x: 96, y: 200, w: 600, h: 40 },
  textRects: [{ x: 96, y: 200, w: 600, h: 40 }],
  color: INK,
  background: PAPER,
  paints: false,
  clip: null,
  icon: null,
  lineHeight: 40,
  ...over,
});

const facts = (over: Partial<RenderFacts> = {}): RenderFacts => ({
  timedOut: false,
  pages: [
    { index: 1, role: 'cover', rect: pageRect(1) },
    { index: 2, role: 'closing', rect: pageRect(2) },
  ],
  elements: [
    el(),
    el({
      idx: 1,
      page: 2,
      rect: { x: 96, y: 1550, w: 600, h: 40 },
      textRects: [{ x: 96, y: 1550, w: 600, h: 40 }],
    }),
  ],
  faces: [
    { family: 'Inter', weight: '400', style: 'normal', status: 'loaded' },
  ],
  platformFonts: {
    0: [{ familyName: 'Inter', isCustomFont: true, glyphCount: 9 }],
    1: [{ familyName: 'Inter', isCustomFont: true, glyphCount: 9 }],
  },
  blockedRequests: [],
  scriptRan: false,
  pdfPageCount: 2,
  ...over,
});

const codes = (f: RenderFacts) => judge(ds, f).map((v) => v.code);

describe('judge', () => {
  test('a clean render has no findings', () => {
    expect(judge(ds, facts())).toEqual([]);
  });

  test('a timed-out render reports only the timeout', () => {
    expect(codes(facts({ timedOut: true, pdfPageCount: null }))).toEqual([
      'render.timeout',
    ]);
  });

  describe('pages', () => {
    test('a page box that is not the definition geometry', () => {
      const f = facts();
      f.pages[1].rect = { x: 0, y: 1350, w: 1080, h: 1600 };
      const [v] = judge(ds, f);
      expect(v).toMatchObject({ code: 'render.pages.geometry', page: 2 });
      expect(v.detail).toContain('1080x1600');
    });

    test('a first page pushed down the canvas shifts every PDF page', () => {
      const f = facts();
      f.pages = f.pages.map((p) => ({
        ...p,
        rect: { ...p.rect, y: p.rect.y + 48 },
      }));
      f.elements = [];
      const found = judge(ds, f).filter(
        (v) => v.code === 'render.pages.geometry',
      );
      expect(found.map((v) => v.page)).toEqual([1, 2]);
    });

    test('a page that does not start where the previous one ended', () => {
      const f = facts();
      f.pages[1].rect = { ...pageRect(2), y: 1400 };
      expect(codes(f)).toContain('render.pages.geometry');
    });

    test('a PDF whose page count differs from the page elements', () => {
      const [v] = judge(ds, facts({ pdfPageCount: 3 }));
      expect(v.code).toBe('render.pdf.pageCount');
      expect(v.detail).toContain('3');
      expect(v.detail).toContain('2');
    });

    test('a page with no text and no icon is blank', () => {
      const f = facts();
      f.elements = [f.elements[0]];
      const [v] = judge(ds, f);
      expect(v).toMatchObject({ code: 'render.pages.blank', page: 2 });
    });
  });

  describe('page.safeArea', () => {
    test('text crossing the bottom safe edge names the element and the distance', () => {
      const f = facts();
      f.elements[0].lineHeight = 92;
      f.elements[0].textRects = [{ x: 96, y: 1200, w: 600, h: 92 }];
      const [v] = judge(ds, f);
      expect(v).toMatchObject({ code: 'page.safeArea', page: 1 });
      expect(v.detail).toContain('p.body');
      expect(v.detail).toContain('bottom');
      expect(v.detail).toContain('38px');
    });

    test('a painted box reaching the bleed is a finding; an unpainted wrapper is not', () => {
      const band = el({
        idx: 2,
        label: 'div.band',
        tag: 'div',
        rect: { x: 0, y: 0, w: 1080, h: 200 },
        textRects: [],
        paints: true,
      });
      const wrapper = el({
        idx: 3,
        label: 'div.stack',
        tag: 'div',
        rect: { x: 0, y: 0, w: 1080, h: 1350 },
        textRects: [],
        paints: false,
      });
      const f = facts();
      f.elements.push(band, wrapper);
      const found = judge(ds, f);
      expect(found.map((v) => v.code)).toEqual(['page.safeArea']);
      expect(found[0].detail).toContain('div.band');
    });

    test('a glyph box taller than a tight line box is measured as the line box', () => {
      // line-height 1.02 on a 92px display face: the Range rect (ascent+descent)
      // is ~20px taller than the 94px line, split evenly above and below it.
      const f = facts();
      f.elements[0].lineHeight = 94;
      f.elements[0].textRects = [{ x: 96, y: 86, w: 600, h: 114 }];
      expect(judge(ds, f)).toEqual([]);
    });

    test('an edge within half a pixel is subpixel rounding, not a finding', () => {
      const f = facts();
      f.elements[0].textRects = [{ x: 95.6, y: 200, w: 600, h: 40 }];
      expect(judge(ds, f)).toEqual([]);
    });
  });

  test('text clipped by an overflowing ancestor', () => {
    const f = facts();
    f.elements[0].textRects = [
      { x: 96, y: 200, w: 600, h: 40 },
      { x: 96, y: 240, w: 600, h: 40 },
    ];
    f.elements[0].clip = {
      label: 'div.box',
      rect: { x: 96, y: 200, w: 600, h: 50 },
    };
    const [v] = judge(ds, f);
    expect(v).toMatchObject({ code: 'render.overflow.clipped', page: 1 });
    expect(v.detail).toContain('div.box');
    expect(v.detail).toContain('1 of 2 lines');
  });

  describe('render.overlap', () => {
    test('text from two elements painted on top of each other', () => {
      const f = facts();
      f.elements.push(
        el({
          idx: 2,
          label: 'h2.heading "Over"',
          textRects: [{ x: 120, y: 210, w: 300, h: 40 }],
        }),
      );
      f.platformFonts[2] = f.platformFonts[0];
      const [v] = judge(ds, f);
      expect(v.code).toBe('render.overlap');
      expect(v.detail).toContain('h2.heading');
      expect(v.detail).toContain('p.body');
    });

    test('lines hidden by a clipping ancestor cannot overlap anything', () => {
      const f = facts();
      f.elements[0].textRects = [
        { x: 96, y: 200, w: 600, h: 40 },
        { x: 96, y: 240, w: 600, h: 40 },
      ];
      f.elements[0].clip = {
        label: 'div.box',
        rect: { x: 96, y: 200, w: 600, h: 40 },
      };
      f.elements.push(
        el({
          idx: 2,
          label: 'p.label "Below"',
          textRects: [{ x: 96, y: 240, w: 300, h: 40 }],
        }),
      );
      f.platformFonts[2] = f.platformFonts[0];
      expect(codes(f)).toEqual(['render.overflow.clipped']);
    });

    test('adjacent lines whose glyph boxes graze each other do not overlap', () => {
      const f = facts();
      // Tight line-height: a Range line box is ascent+descent, taller than the line.
      f.elements.push(
        el({
          idx: 2,
          label: 'strong "next"',
          textRects: [{ x: 96, y: 236, w: 300, h: 40 }],
        }),
      );
      f.platformFonts[2] = f.platformFonts[0];
      expect(judge(ds, f)).toEqual([]);
    });
  });

  describe('fonts', () => {
    test('a face that failed to load', () => {
      const f = facts();
      f.faces.push({
        family: 'Fraunces',
        weight: '700',
        style: 'normal',
        status: 'error',
      });
      expect(codes(f)).toEqual(['render.fonts.failed']);
    });

    test('glyphs painted by a font the design system does not declare', () => {
      const f = facts();
      f.platformFonts[0] = [
        { familyName: 'Inter', isCustomFont: true, glyphCount: 8 },
        { familyName: 'Apple Color Emoji', isCustomFont: false, glyphCount: 1 },
      ];
      const [v] = judge(ds, f);
      expect(v.code).toBe('render.fonts.fallback');
      expect(v.detail).toContain('Apple Color Emoji');
      expect(v.detail).toContain('1 glyph');
    });

    test('an outage explains its own fallbacks: only the failed faces are reported', () => {
      const f = facts();
      f.faces = [
        { family: 'Inter', weight: '400', style: 'normal', status: 'error' },
      ];
      f.platformFonts[0] = [
        { familyName: 'Arial', isCustomFont: false, glyphCount: 9 },
      ];
      expect(codes(f)).toEqual(['render.fonts.failed']);
    });

    test('a declared Google family painted by a local font of the same name is a fallback', () => {
      const f = facts();
      f.platformFonts[0] = [
        { familyName: 'Inter', isCustomFont: false, glyphCount: 9 },
      ];
      expect(codes(f)).toEqual(['render.fonts.fallback']);
    });
  });

  describe('palette.pairings', () => {
    test('a text/background pair the definition does not list', () => {
      const f = facts();
      f.elements[0].color = MUTED;
      f.elements[0].background = ACCENT;
      const [v] = judge(ds, f);
      expect(v.code).toBe('palette.pairings');
      expect(v.detail).toContain('muted on accent');
      expect(v.detail).toMatch(/\d\.\d\d:1/);
    });

    test('a colour that resolves to no token is reported, not paired', () => {
      const f = facts();
      f.elements[0].color = 'rgb(255, 0, 0)';
      expect(codes(f)).toEqual(['palette.pairings']);
    });

    test('an unresolvable (image or gradient) background is not judged', () => {
      const f = facts();
      f.elements[0].color = MUTED;
      f.elements[0].background = null;
      expect(judge(ds, f)).toEqual([]);
    });

    test('translucent colours are not tokens', () => {
      const f = facts();
      f.elements[0].color = 'rgba(20, 17, 15, 0.5)';
      expect(codes(f)).toEqual(['palette.pairings']);
    });
  });

  test('icons.colors: an icon inheriting a colour outside the allowed set', () => {
    const f = facts();
    f.elements.push(
      el({
        idx: 2,
        label: 'svg[data-icon=arrow-right]',
        tag: 'svg',
        icon: 'arrow-right',
        textRects: [],
        paints: true,
        color: MUTED,
        rect: { x: 96, y: 400, w: 32, h: 32 },
      }),
    );
    const [v] = judge(ds, f);
    expect(v).toMatchObject({ code: 'icons.colors', page: 1 });
    expect(v.detail).toContain('muted');
  });

  test('a blocked request is a checker gap', () => {
    const [v] = judge(
      ds,
      facts({ blockedRequests: ['https://evil.example/x.png'] }),
    );
    expect(v.code).toBe('render.egress');
    expect(v.detail).toContain('evil.example');
  });
});
