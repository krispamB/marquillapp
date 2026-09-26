import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { slidesSchema, Slide } from './schemas';
import {
  CarouselThemeId,
  carouselThemes,
  carouselTemplateRegistry,
  loadCarouselTemplates,
} from './templates';

const ASSETS_ROOT = join(process.cwd(), 'assets/carousel');

function loadFixture(theme: string): Slide[] {
  const raw = readFileSync(
    join(ASSETS_ROOT, 'templates', theme, 'fixture.json'),
    'utf-8',
  );
  const parsed = JSON.parse(raw) as { theme: string; slides: unknown };
  // The fixture is only trustworthy as a fit proof if it satisfies the caps.
  return slidesSchema.parse(parsed.slides);
}

describe('carouselTemplateRegistry', () => {
  it('maps every theme x slide type to a .hbs file', () => {
    for (const theme of carouselThemes) {
      const set = carouselTemplateRegistry[theme];
      for (const file of Object.values(set)) {
        expect(file.endsWith('.hbs')).toBe(true);
      }
    }
    // 4 themes x 5 slide types
    expect(carouselThemes.length).toBe(4);
  });
});

describe('loadCarouselTemplates', () => {
  // A minimal asset root the loader reaches `bold/cover.hbs` in — enough to
  // exercise each fail-fast branch on a single crafted template.
  const makeRootWithCover = (label: string, coverSource?: string): string => {
    const root = mkdtempSync(join(tmpdir(), `carousel-${label}-`));
    writeFileSync(join(root, 'base.css'), '.slide{}');
    mkdirSync(join(root, 'templates', 'bold'), { recursive: true });
    writeFileSync(join(root, 'templates', 'bold', 'theme.css'), '');
    if (coverSource !== undefined) {
      writeFileSync(join(root, 'templates', 'bold', 'cover.hbs'), coverSource);
    }
    return root;
  };

  it('compiles the real asset set without throwing', () => {
    expect(() => loadCarouselTemplates()).not.toThrow();
  });

  it('throws when the assets root is missing', () => {
    expect(() =>
      loadCarouselTemplates('/definitely/not/a/real/carousel/root'),
    ).toThrow(/missing or unreadable/i);
  });

  it('throws when a template file is missing', () => {
    // cover.hbs absent — the first template the loader reaches
    const root = makeRootWithCover('missing');
    expect(() => loadCarouselTemplates(root)).toThrow(/missing or unreadable/i);
  });

  it('throws when a template contains a banned triple-stache', () => {
    const root = makeRootWithCover('triple', '<h1>{{{title}}}</h1>');
    expect(() => loadCarouselTemplates(root)).toThrow(/unescaped-output/i);
  });

  it('throws when a template contains the {{& }} unescaped form', () => {
    const root = makeRootWithCover('amp', '<h1>{{& title}}</h1>');
    expect(() => loadCarouselTemplates(root)).toThrow(/unescaped-output/i);
  });

  it('throws when a template fails to compile', () => {
    const root = makeRootWithCover('badhbs', '{{#if title}}unterminated');
    expect(() => loadCarouselTemplates(root)).toThrow(/failed to compile/i);
  });
});

describe('assembleHtml', () => {
  const templates = loadCarouselTemplates();

  it.each(carouselThemes)(
    'assembles the %s fixture deck cleanly',
    (theme: CarouselThemeId) => {
      const slides = loadFixture(theme);
      const html = templates.assembleHtml(theme, slides);

      // one <section> per slide, in order
      const sections = html.match(/<section class="slide slide--/g) ?? [];
      expect(sections.length).toBe(slides.length);
      expect(slides.length).toBe(15);

      // a complete, single document
      expect(html.startsWith('<!doctype html>')).toBe(true);
      expect(html.trimEnd().endsWith('</html>')).toBe(true);

      // every template placeholder was applied — no stray handlebars left
      expect(html).not.toMatch(/\{\{/);

      // the load-bearing frame and last-child override are inlined
      expect(html).toContain('break-after: page');
      expect(html).toContain('.slide:last-child');

      // self-contained: nothing to fetch over the network
      expect(html).not.toMatch(/\bsrc=/);
      expect(html).not.toMatch(/<link\b/);
      expect(html).not.toMatch(/@import/);
    },
  );

  it('HTML-escapes untrusted field content', () => {
    const slides: Slide[] = [
      {
        type: 'content',
        fields: { heading: 'Safe', body: '<script>alert(1)</script> & "x"' },
      },
      { type: 'content', fields: { heading: 'H2', body: 'B2' } },
    ];
    const html = loadCarouselTemplates().assembleHtml('bold', slides);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('throws on an unknown slide type', () => {
    const slides = [{ type: 'image', fields: {} }] as unknown as Slide[];
    expect(() => loadCarouselTemplates().assembleHtml('bold', slides)).toThrow(
      /No carousel template/i,
    );
  });

  it('throws on an unknown theme', () => {
    expect(() =>
      loadCarouselTemplates().assembleHtml('neon' as CarouselThemeId, []),
    ).toThrow(/Unknown carousel theme/i);
  });
});
