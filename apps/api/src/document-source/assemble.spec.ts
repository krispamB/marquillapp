import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DesignSystemDefinition,
  parseDesignSystemDefinition,
} from '../design-system/design-system-definition';
import { DESIGN_SYSTEM_SEED_DIR } from '../design-system/design-system.constants';
import { catalogIcon } from '../design-system/icon-catalog';
import {
  assemble,
  assertIconsFilled,
  fontStylesheetUrl,
  frameCss,
  isFontRequest,
} from './assemble';
import { check } from './candidate-check';
import { IconInliningError } from './icon-inlining.error';

type Element = DefaultTreeAdapterMap['element'];
type ParentNode = DefaultTreeAdapterMap['parentNode'];

const definitionOf = (id: string): DesignSystemDefinition => {
  const parsed = parseDesignSystemDefinition(
    readFileSync(
      join(DESIGN_SYSTEM_SEED_DIR, id, 'definition.ds.yaml'),
      'utf8',
    ),
  );
  if (!parsed.success) throw new Error(parsed.errors.join('\n'));
  return parsed.definition;
};
const sampleOf = (id: string) =>
  readFileSync(join(DESIGN_SYSTEM_SEED_DIR, id, 'sample.html'), 'utf8');

const margin = definitionOf('margin');

const candidate = (page: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
:root { --ds-white: #ffffff; --ds-ink: #0a0a0a; }
</style>
</head>
<body>
<section class="page" data-role="title"><h1>Title</h1></section>
${page}
</body>
</html>
`;

const elements = (node: ParentNode): Element[] =>
  node.childNodes.flatMap((child) =>
    'tagName' in child ? [child, ...elements(child)] : [],
  );
const attrs = (element: Element) =>
  Object.fromEntries(element.attrs.map((attr) => [attr.name, attr.value]));
const headOf = (html: string) =>
  elements(parse(html)).find((element) => element.tagName === 'head')!;
const svgsOf = (html: string) =>
  elements(parse(html)).filter((element) => element.tagName === 'svg');

describe('frameCss', () => {
  const css = frameCss(margin);

  it.each([
    'width: 1080px',
    'height: 1350px',
    'box-sizing: border-box',
    'padding: 112px 112px 112px 112px',
    'background: var(--ds-white)',
    'overflow: hidden',
    'overflow-wrap: break-word',
    'break-after: page',
    'contain: strict',
  ])('should set %s on .page', (declaration) => {
    expect(css).toMatch(
      new RegExp(`\\.page \\{[^}]*${declaration.replace(/[()]/g, '\\$&')};`),
    );
  });

  it('should take the padding from the safe area, side by side', () => {
    const definition = {
      ...margin,
      page: {
        ...margin.page,
        safeArea: { top: 8, right: 16, bottom: 24, left: 32 },
      },
    };

    expect(frameCss(definition)).toContain('padding: 8px 16px 24px 32px;');
  });

  it('should let the last page end the document', () => {
    expect(css).toContain('.page:last-child { break-after: auto; }');
  });

  it('should never set display', () => {
    expect(css).not.toContain('display');
  });
});

describe('fontStylesheetUrl', () => {
  it('should request the declared Google family and weights with display=block', () => {
    expect(fontStylesheetUrl(margin)).toBe(
      'https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500&display=block',
    );
  });

  it('should request italic axes when a family ships italic', () => {
    expect(fontStylesheetUrl(definitionOf('colophon'))).toContain(
      'family=Bodoni+Moda:ital,wght@0,400;0,500;0,700;1,400;1,500;1,700',
    );
  });

  it('should leave out families outside the allowlist and system families', () => {
    const font = margin.typography.fonts[0];
    const definition: DesignSystemDefinition = {
      ...margin,
      typography: {
        ...margin.typography,
        fonts: [
          font,
          { ...font, name: 'comic', family: 'Comic Neue' },
          { ...font, name: 'system', family: 'Helvetica', source: 'system' },
        ],
      },
    };

    expect(fontStylesheetUrl(definition)).toBe(fontStylesheetUrl(margin));
  });

  it('should return nothing when no family is fetched', () => {
    const definition: DesignSystemDefinition = {
      ...margin,
      typography: {
        ...margin.typography,
        fonts: [
          {
            ...margin.typography.fonts[0],
            family: 'Helvetica',
            source: 'system',
          },
        ],
      },
    };

    expect(fontStylesheetUrl(definition)).toBeUndefined();
  });
});

describe('isFontRequest', () => {
  it.each([
    'https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500&display=block',
    'https://fonts.gstatic.com/s/intertight/v7/abc.woff2',
  ])('should allow %s', (url) => {
    expect(isFontRequest(url)).toBe(true);
  });

  it.each([
    'https://fonts.googleapis.com/css?family=Inter',
    'http://fonts.gstatic.com/s/a.woff2',
    'https://fonts.gstatic.com.evil.example/a.woff2',
    'https://example.com/a.png',
    'data:font/woff2;base64,AAAA',
    'not a url',
  ])('should refuse %s', (url) => {
    expect(isFontRequest(url)).toBe(false);
  });

  it('should allow the stylesheet assembly links', () => {
    expect(isFontRequest(fontStylesheetUrl(margin)!)).toBe(true);
  });
});

describe('assemble', () => {
  const page =
    '<section class="page" data-role="end"><p><svg class="i" data-icon="arrow-right" data-size="24"></svg>Next</p></section>';
  const source = assemble(margin, candidate(page));

  it('should add the frame as a second <style> after the candidate stylesheet', () => {
    const head = headOf(source);
    const styles = head.childNodes.filter(
      (node): node is Element => 'tagName' in node && node.tagName === 'style',
    );

    expect(styles).toHaveLength(2);
    expect((styles[0].childNodes[0] as { value: string }).value).toContain(
      '--ds-white',
    );
    expect((styles[1].childNodes[0] as { value: string }).value).toBe(
      frameCss(margin),
    );
    expect(head.childNodes.filter((n) => 'tagName' in n).at(-1)).toBe(
      styles[1],
    );
  });

  it('should link the Google Fonts stylesheet', () => {
    const links = elements(headOf(source)).filter((e) => e.tagName === 'link');

    expect(links.map(attrs)).toEqual([
      { rel: 'stylesheet', href: fontStylesheetUrl(margin) },
    ]);
  });

  it('should fill each icon placeholder from the pinned catalog', () => {
    const [svg] = svgsOf(source);

    expect(attrs(svg)).toEqual({
      class: 'i',
      'data-icon': 'arrow-right',
      'data-size': '24',
      viewBox: '0 0 24 24',
      width: '24',
      height: '24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false',
    });
    expect(
      svg.childNodes.map((node) => [
        (node as Element).tagName,
        attrs(node as Element),
      ]),
    ).toEqual(catalogIcon('arrow-right'));
  });

  it('should size each icon from its data-size', () => {
    const definition = {
      ...margin,
      icons: { ...margin.icons, sizes: [24, 48] },
    };
    const [svg] = svgsOf(
      assemble(
        definition,
        candidate(page.replace('data-size="24"', 'data-size="48"')),
      ),
    );

    expect(attrs(svg)).toMatchObject({ width: '48', height: '48' });
  });

  it('should throw a distinct error when an icon is not in the catalog', () => {
    expect(() =>
      assemble(margin, candidate(page.replace('arrow-right', 'not-an-icon'))),
    ).toThrow(IconInliningError);
  });

  it('should throw a distinct error when an icon size is not a number', () => {
    expect(() =>
      assemble(
        margin,
        candidate(page.replace('data-size="24"', 'data-size="big"')),
      ),
    ).toThrow(IconInliningError);
  });

  it('should leave everything else in the candidate as it was', () => {
    expect(source).toContain(
      '<section class="page" data-role="title"><h1>Title</h1></section>',
    );
    expect(source).toContain(
      ':root { --ds-white: #ffffff; --ds-ink: #0a0a0a; }',
    );
  });

  it('should produce a Document Source the grammar no longer accepts', () => {
    expect(check(margin, source).map((v) => v.code)).toEqual(
      expect.arrayContaining(['envelope.head', 'envelope.svg']),
    );
  });

  it('should be deterministic', () => {
    expect(assemble(margin, candidate(page))).toBe(source);
  });

  it('should assemble a seed sample without leaving a placeholder', () => {
    const assembled = assemble(
      definitionOf('afterglow'),
      sampleOf('afterglow'),
    );

    expect(svgsOf(assembled).length).toBeGreaterThan(0);
    expect(svgsOf(assembled).every((svg) => svg.childNodes.length > 0)).toBe(
      true,
    );
  });
});

describe('assertIconsFilled', () => {
  it('should throw when a placeholder is left unfilled', () => {
    expect(() =>
      assertIconsFilled(
        candidate(
          '<section class="page" data-role="end"><svg data-icon="x" data-size="24"></svg></section>',
        ),
      ),
    ).toThrow(IconInliningError);
  });

  it('should pass when every icon has content', () => {
    expect(() =>
      assertIconsFilled(
        candidate(
          '<section class="page" data-role="end"><svg data-icon="x" data-size="24"><path d="M0 0"></path></svg></section>',
        ),
      ),
    ).not.toThrow();
  });
});
