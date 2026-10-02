import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseDesignSystemDefinition,
  type DesignSystemDefinition,
} from '../design-system/design-system-definition';
import { DESIGN_SYSTEM_SEED_DIR } from '../design-system/design-system.constants';
import { judge, lineBox } from './judge';
import type { ProbeElement, RenderFacts } from './render-facts';
import { RENDER_REMEDIES } from './render-remedy';

/**
 * Test layer 1 (§11.2): the judge on probe facts. The recorded facts are what
 * the real session measured (`test:render`) for the margin sample and two
 * corpus fixtures; the rest are minimal facts, one failing and one passing
 * case per code.
 */

const parsed = parseDesignSystemDefinition(
  readFileSync(
    join(DESIGN_SYSTEM_SEED_DIR, 'margin', 'definition.ds.yaml'),
    'utf8',
  ),
);
if (!parsed.success) throw new Error(parsed.errors.join('\n'));
// margin: 1080x1350, safe area 112 all round, white paper, ink and grey text,
// a hairline border colour, Inter Tight from Google, icons in ink only.
const margin: DesignSystemDefinition = parsed.definition;

const recorded = (name: string): RenderFacts =>
  JSON.parse(
    readFileSync(join(__dirname, 'recorded-facts', `${name}.json`), 'utf8'),
  ) as RenderFacts;

const WHITE = 'rgb(255, 255, 255)';
const INK = 'rgb(10, 10, 10)';
const GREY = 'rgb(110, 110, 110)';
const HAIRLINE = 'rgb(226, 226, 226)';

const pageRect = (i: number) => ({ x: 0, y: (i - 1) * 1350, w: 1080, h: 1350 });

const el = (over: Partial<ProbeElement> = {}): ProbeElement => ({
  idx: 0,
  page: 1,
  label: 'p.body "Some text"',
  tag: 'p',
  rect: { x: 112, y: 200, w: 600, h: 40 },
  textRects: [{ x: 112, y: 200, w: 600, h: 40 }],
  color: INK,
  translucent: false,
  backgrounds: [WHITE],
  paints: false,
  placed: false,
  clip: null,
  icon: null,
  lineHeight: 40,
  ...over,
});

const facts = (over: Partial<RenderFacts> = {}): RenderFacts => ({
  timedOut: false,
  pages: [
    { index: 1, role: 'title', rect: pageRect(1) },
    { index: 2, role: 'end', rect: pageRect(2) },
  ],
  elements: [
    el(),
    el({
      idx: 1,
      page: 2,
      rect: { x: 112, y: 1550, w: 600, h: 40 },
      textRects: [{ x: 112, y: 1550, w: 600, h: 40 }],
    }),
  ],
  faces: [
    { family: 'Inter Tight', weight: '400', style: 'normal', status: 'loaded' },
  ],
  platformFonts: {
    0: [{ familyName: 'Inter Tight', isCustomFont: true, glyphCount: 9 }],
    1: [{ familyName: 'Inter Tight', isCustomFont: true, glyphCount: 9 }],
  },
  refusedRequests: [],
  pdfPageCount: 2,
  ...over,
});

const codes = (f: RenderFacts) => judge(margin, f).map((v) => v.code);

describe('judge', () => {
  describe('recorded probe facts', () => {
    it('should find nothing when the margin sample rendered', () => {
      expect(judge(margin, recorded('margin-sample'))).toEqual([]);
    });

    it('should find the nudged title when the safe-area fixture rendered', () => {
      expect(judge(margin, recorded('safe-area'))).toEqual([
        {
          code: 'page.safeArea',
          detail:
            'page 1: h1.title.nudge "Three fixes for carousels people…" crosses the left safe edge by 48px',
          page: 1,
        },
      ]);
    });

    it('should find the undeclared pairings and the icon colour when the colour fixture rendered', () => {
      expect(judge(margin, recorded('colour'))).toEqual([
        {
          code: 'palette.pairings',
          detail:
            'page 1: p.meta.chip "New" sets grey on hairline (3.94:1), which is not a declared pairing',
          page: 1,
        },
        {
          code: 'palette.pairings',
          detail:
            'page 2: h1.title "Save this for the next one." sets ink on ink (1.00:1), which is not a declared pairing',
          page: 2,
        },
        {
          code: 'icons.colors',
          detail:
            'page 1: svg[data-icon=arrow-right] inherits grey; icons may be ink',
          page: 1,
        },
      ]);
    });
  });

  it('should find nothing when the facts are clean', () => {
    expect(judge(margin, facts())).toEqual([]);
  });

  it('should only use codes that have a remedy, never with a line', () => {
    const everything = facts({
      pdfPageCount: 3,
      refusedRequests: ['https://example.com/x.png'],
    });
    everything.elements[0].color = GREY;
    everything.elements[0].backgrounds = [HAIRLINE];
    for (const v of judge(margin, everything)) {
      expect(Object.keys(RENDER_REMEDIES)).toContain(v.code);
      expect(v.line).toBeUndefined();
    }
  });

  describe('render.timeout', () => {
    it('should report only the timeout when the session timed out', () => {
      expect(codes(facts({ timedOut: true, pdfPageCount: null }))).toEqual([
        'render.timeout',
      ]);
    });

    it('should still report egress when the session timed out', () => {
      expect(
        codes(
          facts({
            timedOut: true,
            pdfPageCount: null,
            refusedRequests: ['https://example.com/x.css'],
          }),
        ),
      ).toEqual(['render.timeout', 'render.egress']);
    });
  });

  describe('render.pages.geometry', () => {
    it('should report a page box of the wrong size', () => {
      const f = facts();
      f.pages[1].rect = { x: 0, y: 1350, w: 1080, h: 1600 };
      const [v] = judge(margin, f);
      expect(v).toMatchObject({ code: 'render.pages.geometry', page: 2 });
      expect(v.detail).toBe(
        'page 2: the page box is 1080x1600 at x=0, y=1350; it must be 1080x1350 at x=0, y=1350',
      );
    });

    it('should report every page when the first is pushed down the canvas', () => {
      const f = facts({ elements: [] });
      f.pages = f.pages.map((p) => ({
        ...p,
        rect: { ...p.rect, y: p.rect.y + 48 },
      }));
      const found = judge(margin, f).filter(
        (v) => v.code === 'render.pages.geometry',
      );
      expect(found.map((v) => v.page)).toEqual([1, 2]);
    });

    it('should accept a page within the 1px tolerance', () => {
      const f = facts();
      f.pages[1].rect = { ...pageRect(2), y: 1350.8 };
      expect(codes(f)).toEqual([]);
    });
  });

  describe('render.pdf.pageCount', () => {
    it('should report a PDF with more pages than page elements', () => {
      const [v] = judge(margin, facts({ pdfPageCount: 3 }));
      expect(v.code).toBe('render.pdf.pageCount');
      expect(v.page).toBeUndefined();
      expect(v.detail).toContain('the PDF has 3 pages');
      expect(v.detail).toContain('2 page elements');
    });

    it('should not judge the count when nothing was printed', () => {
      expect(codes(facts({ pdfPageCount: null }))).toEqual([]);
    });
  });

  describe('render.pages.blank', () => {
    it('should report a page with no text and no icon', () => {
      const f = facts();
      f.elements = [f.elements[0]];
      expect(judge(margin, f)).toEqual([
        {
          code: 'render.pages.blank',
          detail: 'page 2: shows no text and no icon',
          page: 2,
        },
      ]);
    });

    it('should accept a page that shows only an icon', () => {
      const f = facts();
      f.elements[1] = el({
        idx: 1,
        page: 2,
        label: 'svg[data-icon=arrow-right]',
        tag: 'svg',
        icon: 'arrow-right',
        textRects: [],
        backgrounds: [],
        paints: true,
        rect: { x: 112, y: 1550, w: 24, h: 24 },
      });
      expect(codes(f)).toEqual([]);
    });
  });

  describe('page.safeArea', () => {
    it('should name the page, the element and the distance when text crosses the bottom edge', () => {
      const f = facts();
      f.elements[0].lineHeight = 92;
      f.elements[0].textRects = [{ x: 112, y: 1180, w: 600, h: 92 }];
      expect(judge(margin, f)).toEqual([
        {
          code: 'page.safeArea',
          detail:
            'page 1: p.body "Some text" crosses the bottom safe edge by 34px',
          page: 1,
        },
      ]);
    });

    it('should report a painted box in the margin but not an unpainted wrapper', () => {
      const band = el({
        idx: 2,
        label: 'div.band',
        tag: 'div',
        rect: { x: 0, y: 0, w: 1080, h: 200 },
        textRects: [],
        backgrounds: [],
        paints: true,
      });
      const wrapper = el({
        idx: 3,
        label: 'div.stack',
        tag: 'div',
        rect: { x: 0, y: 0, w: 1080, h: 1350 },
        textRects: [],
        backgrounds: [],
      });
      const f = facts();
      f.elements.push(band, wrapper);
      const found = judge(margin, f);
      expect(found.map((v) => v.code)).toEqual(['page.safeArea']);
      expect(found[0].detail).toContain('div.band');
    });

    it('should measure a tight glyph box as its line box', () => {
      // A 72px title at line-height 1.05 (75.6px): the Range rect is 87px
      // tall, 5.7px above and below the line. Recorded from a real render.
      const f = facts();
      f.elements[0].lineHeight = 75.6;
      f.elements[0].textRects = [{ x: 112, y: 106.3, w: 600, h: 87 }];
      expect(judge(margin, f)).toEqual([]);
    });

    it('should accept an edge within the 1px tolerance', () => {
      const f = facts();
      f.elements[0].textRects = [{ x: 111.2, y: 200, w: 600, h: 40 }];
      expect(judge(margin, f)).toEqual([]);
    });

    it('should accept a placed element that bleeds off the page', () => {
      const f = facts();
      f.elements.push(
        el({
          idx: 2,
          label: 'p.glyph "1"',
          placed: true,
          rect: { x: 700, y: 240, w: 540, h: 768 },
          textRects: [{ x: 700, y: 240, w: 540, h: 768 }],
          lineHeight: 768,
        }),
      );
      f.platformFonts[2] = f.platformFonts[0];
      expect(judge(margin, f)).toEqual([]);
    });

    it('should report placed text that lies entirely off its page', () => {
      const f = facts();
      f.elements.push(
        el({
          idx: 2,
          label: 'p.tag "Lost"',
          placed: true,
          rect: { x: 112, y: 6000, w: 300, h: 40 },
          textRects: [{ x: 112, y: 6000, w: 300, h: 40 }],
        }),
      );
      f.platformFonts[2] = f.platformFonts[0];
      expect(judge(margin, f)).toEqual([
        {
          code: 'page.safeArea',
          detail: 'page 1: p.tag "Lost" is placed entirely off the page',
          page: 1,
        },
      ]);
    });
  });

  describe('render.overflow.clipped', () => {
    it('should report lines hidden by an overflowing ancestor, once', () => {
      const f = facts();
      f.elements[0].textRects = [
        { x: 112, y: 200, w: 600, h: 40 },
        { x: 112, y: 240, w: 600, h: 40 },
      ];
      f.elements[0].backgrounds = [WHITE, WHITE];
      f.elements[0].clip = {
        label: 'div.box',
        rect: { x: 112, y: 200, w: 600, h: 48 },
      };
      expect(judge(margin, f)).toEqual([
        {
          code: 'render.overflow.clipped',
          detail:
            'page 1: p.body "Some text": 1 of 2 lines are cut off by div.box, which hides its overflow',
          page: 1,
        },
      ]);
    });

    it('should accept text that fits inside its clipping ancestor', () => {
      const f = facts();
      f.elements[0].clip = {
        label: 'div.box',
        rect: { x: 112, y: 200, w: 600, h: 48 },
      };
      expect(judge(margin, f)).toEqual([]);
    });
  });

  describe('render.overlap', () => {
    it('should report text painted over other text, with the depth', () => {
      const f = facts();
      f.elements.push(
        el({
          idx: 2,
          label: 'p.tag "Over"',
          textRects: [{ x: 120, y: 210, w: 300, h: 40 }],
        }),
      );
      f.platformFonts[2] = f.platformFonts[0];
      expect(judge(margin, f)).toEqual([
        {
          code: 'render.overlap',
          detail:
            'page 1: p.tag "Over" is painted over p.body "Some text" by 30px',
          page: 1,
        },
      ]);
    });

    it('should accept adjacent lines whose boxes graze', () => {
      const f = facts();
      f.elements.push(
        el({
          idx: 2,
          label: 'p.next "Next"',
          textRects: [{ x: 112, y: 236, w: 300, h: 40 }],
        }),
      );
      f.platformFonts[2] = f.platformFonts[0];
      expect(judge(margin, f)).toEqual([]);
    });

    it('should not count a clipped line as overlapping', () => {
      const f = facts();
      f.elements[0].textRects = [
        { x: 112, y: 200, w: 600, h: 40 },
        { x: 112, y: 240, w: 600, h: 40 },
      ];
      f.elements[0].backgrounds = [WHITE, WHITE];
      f.elements[0].clip = {
        label: 'div.box',
        rect: { x: 112, y: 200, w: 600, h: 40 },
      };
      f.elements.push(
        el({
          idx: 2,
          label: 'p.below "Below"',
          textRects: [{ x: 112, y: 240, w: 300, h: 40 }],
        }),
      );
      f.platformFonts[2] = f.platformFonts[0];
      expect(codes(f)).toEqual(['render.overflow.clipped']);
    });
  });

  describe('render.fonts.fallback', () => {
    it('should report glyphs painted by a font the definition does not declare', () => {
      const f = facts();
      f.platformFonts[0] = [
        { familyName: 'Inter Tight', isCustomFont: true, glyphCount: 8 },
        { familyName: 'Noto Color Emoji', isCustomFont: false, glyphCount: 1 },
      ];
      expect(judge(margin, f)).toEqual([
        {
          code: 'render.fonts.fallback',
          detail:
            'page 1: p.body "Some text" painted 1 glyph in Noto Color Emoji, not a declared family',
          page: 1,
        },
      ]);
    });

    it('should report a local copy of a declared Google family', () => {
      const f = facts();
      f.platformFonts[0] = [
        { familyName: 'Inter Tight', isCustomFont: false, glyphCount: 9 },
      ];
      const [v] = judge(margin, f);
      expect(v.code).toBe('render.fonts.fallback');
      expect(v.detail).toContain('(a local copy)');
    });

    it('should accept a named instance of a declared web font', () => {
      const f = facts();
      f.platformFonts[0] = [
        { familyName: 'Inter Tight Medium', isCustomFont: true, glyphCount: 9 },
      ];
      expect(judge(margin, f)).toEqual([]);
    });

    it('should not take a longer family for a declared one', () => {
      const f = facts();
      f.platformFonts[0] = [
        { familyName: 'Inter', isCustomFont: true, glyphCount: 9 },
      ];
      expect(codes(f)).toEqual(['render.fonts.fallback']);
    });
  });

  describe('render.fonts.failed', () => {
    it('should report a face that failed to load, without its fallbacks', () => {
      const f = facts();
      f.faces.push({
        family: 'Inter Tight',
        weight: '500',
        style: 'normal',
        status: 'error',
      });
      f.platformFonts[0] = [
        { familyName: 'Liberation Sans', isCustomFont: false, glyphCount: 9 },
      ];
      expect(judge(margin, f)).toEqual([
        {
          code: 'render.fonts.failed',
          detail: 'Inter Tight 500 normal failed to load',
        },
      ]);
    });

    it('should accept faces that are loaded or never used', () => {
      const f = facts();
      f.faces.push({
        family: 'Inter Tight',
        weight: '500',
        style: 'normal',
        status: 'unloaded',
      });
      expect(codes(f)).toEqual([]);
    });
  });

  describe('palette.pairings', () => {
    it('should report a text and background pair the definition does not list', () => {
      const f = facts();
      f.elements[0].color = GREY;
      f.elements[0].backgrounds = [HAIRLINE];
      const [v] = judge(margin, f);
      expect(v.code).toBe('palette.pairings');
      expect(v.detail).toContain('grey on hairline');
      expect(v.detail).toMatch(/\(\d\.\d\d:1\)/);
    });

    it('should report each distinct background under the lines', () => {
      const f = facts();
      f.elements[0].textRects = [
        { x: 112, y: 200, w: 600, h: 40 },
        { x: 112, y: 240, w: 600, h: 40 },
        { x: 112, y: 280, w: 600, h: 40 },
      ];
      f.elements[0].backgrounds = [WHITE, INK, INK];
      const found = judge(margin, f);
      expect(found.map((v) => v.detail)).toEqual([
        expect.stringContaining('ink on ink'),
      ]);
    });

    it('should report a colour that is not a palette token', () => {
      const f = facts();
      f.elements[0].color = 'rgb(255, 0, 0)';
      const [v] = judge(margin, f);
      expect(v.code).toBe('palette.pairings');
      expect(v.detail).toContain('rgb(255, 0, 0) is not a palette token');
    });

    it('should skip a line over a gradient, an image or a composited paint', () => {
      const f = facts();
      f.elements[0].color = GREY;
      f.elements[0].backgrounds = [null];
      expect(judge(margin, f)).toEqual([]);
    });

    it('should skip translucent text', () => {
      const f = facts();
      f.elements[0].color = 'rgba(10, 10, 10, 0.5)';
      f.elements[0].translucent = true;
      f.elements[0].backgrounds = [HAIRLINE];
      expect(judge(margin, f)).toEqual([]);
    });
  });

  describe('icons.colors', () => {
    const icon = (color: string) =>
      el({
        idx: 2,
        label: 'svg[data-icon=arrow-right]',
        tag: 'svg',
        icon: 'arrow-right',
        textRects: [],
        backgrounds: [],
        paints: true,
        color,
        rect: { x: 112, y: 400, w: 24, h: 24 },
      });

    it('should report an icon inheriting a colour outside the allowed set', () => {
      const f = facts();
      f.elements.push(icon(GREY));
      expect(judge(margin, f)).toEqual([
        {
          code: 'icons.colors',
          detail:
            'page 1: svg[data-icon=arrow-right] inherits grey; icons may be ink',
          page: 1,
        },
      ]);
    });

    it('should accept an icon in an allowed colour', () => {
      const f = facts();
      f.elements.push(icon(INK));
      expect(judge(margin, f)).toEqual([]);
    });
  });

  describe('render.egress', () => {
    it('should report every refused request', () => {
      expect(
        judge(
          margin,
          facts({ refusedRequests: ['https://example.com/x.png'] }),
        ),
      ).toEqual([
        {
          code: 'render.egress',
          detail:
            'the document requested https://example.com/x.png, which the session refused; the static check should have rejected it',
        },
      ]);
    });
  });
});

describe('lineBox', () => {
  it('should remove negative half-leading from both sides of a glyph box', () => {
    expect(lineBox({ x: 0, y: 100, w: 10, h: 87 }, 75.6)).toEqual({
      x: 0,
      y: 105.7,
      w: 10,
      h: 75.6,
    });
  });

  it('should keep the glyph box when the line is as tall or taller', () => {
    const glyphs = { x: 0, y: 100, w: 10, h: 40 };
    expect(lineBox(glyphs, 58)).toBe(glyphs);
    expect(lineBox(glyphs, null)).toBe(glyphs);
  });
});
