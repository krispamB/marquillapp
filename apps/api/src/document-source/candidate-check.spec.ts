import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DesignSystemDefinition,
  parseDesignSystemDefinition,
} from '../design-system/design-system-definition';
import { DESIGN_SYSTEM_SEED_DIR } from '../design-system/design-system.constants';
import { check } from './candidate-check';
import { CANDIDATE_SOURCE_MAX_BYTES } from './document-source.constants';

const parsed = parseDesignSystemDefinition(
  readFileSync(
    join(DESIGN_SYSTEM_SEED_DIR, 'margin', 'definition.ds.yaml'),
    'utf8',
  ),
);
if (!parsed.success) throw new Error(parsed.errors.join('\n'));
/** margin: 2–15 pages, roles title (first, required) / statement / list / end (last, required). */
const margin: DesignSystemDefinition = parsed.definition;

const ROOT = `:root {
  --ds-white: #ffffff;
  --ds-ink: #0a0a0a;
  --ds-grey: #6e6e6e;
  --ds-hairline: #e2e2e2;
}`;

const CSS = `${ROOT}
html, body { margin: 0; padding: 0; }
.sheet { display: flex; flex-direction: column; height: 100%; color: var(--ds-ink); font-family: 'Inter Tight', -apple-system, sans-serif; }
.title { font-size: 72px; line-height: 1.05; font-weight: 500; margin: 0; }
.meta { font-size: 24px; color: var(--ds-grey); margin: 32px 0 0; }`;

const TITLE =
  '<section class="page" data-role="title"><div class="sheet"><h1 class="title">One idea per page.</h1></div></section>';
const END =
  '<section class="page" data-role="end"><div class="sheet"><p class="meta"><svg data-icon="arrow-right" data-size="24"></svg>Follow for more</p></div></section>';

interface Parts {
  doctype?: string;
  html?: string;
  head?: string;
  css?: string;
  pages?: string[];
  body?: string;
}

const candidate = ({
  doctype = '<!doctype html>',
  html = '<html lang="en">',
  head = '',
  css = '',
  pages = [TITLE, END],
  body = '',
}: Parts = {}) =>
  `${doctype}
${html}
<head>
<meta charset="utf-8">
<title>One idea per page</title>
${head}<style>
${CSS}
${css}
</style>
</head>
<body>
${pages.join('\n')}
${body}</body>
</html>
`;

const page = (inner: string, role = 'statement') =>
  `<section class="page" data-role="${role}"><div class="sheet">${inner}</div></section>`;
const withPage = (inner: string, role?: string) => ({
  pages: [TITLE, page(inner, role), END],
});

const codesOf = (source: string, definition = margin) =>
  check(definition, source).map((violation) => violation.code);

type Case = [name: string, parts: Parts | string];

/** Each code: failing fixtures that raise exactly that code, then a passing one. */
const fixtures: Record<string, { fail: Case[]; pass: Case[] }> = {
  'envelope.truncated': {
    fail: [
      ['an output cut off mid-tag', candidate().slice(0, 300)],
      ['an output cut off mid-page', candidate().split('</section>')[0]],
      [
        'a source over 256 KB',
        candidate(withPage(`<p>${'a'.repeat(CANDIDATE_SOURCE_MAX_BYTES)}</p>`)),
      ],
    ],
    pass: [['a complete source under 256 KB', candidate()]],
  },
  'envelope.document': {
    fail: [
      ['no doctype', { doctype: '' }],
      [
        'a quirks-mode doctype',
        {
          doctype:
            '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">',
        },
      ],
      [
        'an html attribute other than lang',
        { html: '<html lang="en" manifest="x">' },
      ],
    ],
    pass: [['an explicit doctype, html, head and body', {}]],
  },
  'envelope.head': {
    fail: [
      [
        'a <link>',
        { head: '<link rel="stylesheet" href="https://example.com/a.css">\n' },
      ],
      ['a second <style>', { head: '<style>.a { margin: 0; }</style>\n' }],
      ['a <script>', { head: '<script>alert(1)</script>\n' }],
      ['a <base>', { head: '<base href="https://example.com/">\n' }],
      [
        'another <meta>',
        { head: '<meta name="viewport" content="width=device-width">\n' },
      ],
      ['a second <title>', { head: '<title>Again</title>\n' }],
      [
        'an attribute on <style>',
        candidate().replace('<style>', '<style media="print">'),
      ],
      [
        'a <meta charset> that is not utf-8',
        candidate().replace('utf-8', 'latin1'),
      ],
      ['no <meta charset>', candidate().replace('<meta charset="utf-8">', '')],
    ],
    pass: [['meta charset, title and one style', {}]],
  },
  'envelope.body': {
    fail: [
      ['a body child that is not a page', { body: '<p>Loose</p>\n' }],
      ['text directly in body', { body: 'Loose text\n' }],
      [
        'a section without the page class',
        {
          pages: [
            TITLE,
            '<section data-role="statement"><p>x</p></section>',
            END,
          ],
        },
      ],
      [
        'a page with another class',
        {
          pages: [
            TITLE,
            '<section class="page cover" data-role="statement"><p>x</p></section>',
            END,
          ],
        },
      ],
      [
        'an attribute on body',
        candidate().replace('<body>', '<body class="x">'),
      ],
    ],
    pass: [['pages and whitespace only', {}]],
  },
  'envelope.element': {
    fail: [
      ['an <img>', withPage('<img src="x.png">')],
      ['an <a>', withPage('<a>Link</a>')],
      ['a <table>', withPage('<table><tr><td>x</td></tr></table>')],
      ['a <script>', withPage('<script>alert(1)</script>')],
      ['an <iframe>', withPage('<iframe></iframe>')],
      ['a <button>', withPage('<button>x</button>')],
      ['a <style> inside a page', withPage('<style>.a { margin: 0; }</style>')],
      ['a <math>', withPage('<math><mi>x</mi></math>')],
      ['a <noscript>', withPage('<noscript>x</noscript>')],
    ],
    pass: [
      [
        'every allowed element',
        withPage(
          '<header><span>a</span></header><figure><blockquote><q>b</q><cite>c</cite></blockquote><figcaption>d</figcaption></figure>' +
            '<ul><li><strong>e</strong></li></ul><ol><li><em>f</em></li></ol><h2>g<sup>1</sup><sub>2</sub></h2><h3>h</h3><h4>i</h4><h5>j</h5><h6>k</h6>' +
            '<p><small>l</small><br></p><hr><footer>m</footer>',
        ),
      ],
    ],
  },
  'envelope.attribute': {
    fail: [
      ['an id', withPage('<p id="a">x</p>')],
      ['an inline style', withPage('<p style="color: red">x</p>')],
      ['an on* handler', withPage('<p onclick="alert(1)">x</p>')],
      [
        'an upper-case on* handler',
        withPage('<p ONMOUSEOVER="alert(1)">x</p>'),
      ],
      ['an href', withPage('<span href="https://example.com">x</span>')],
      ['data-role off a page', withPage('<div data-role="title">x</div>')],
      [
        'data-icon off an svg',
        withPage('<span data-icon="arrow-right">x</span>'),
      ],
      ['another data attribute', withPage('<p data-x="1">x</p>')],
      [
        'an extra attribute on a page',
        {
          pages: [
            TITLE,
            '<section class="page" data-role="statement" title="x"><p>x</p></section>',
            END,
          ],
        },
      ],
    ],
    pass: [
      [
        'class on any element',
        withPage('<p class="a b">x<span class="c">y</span></p>'),
      ],
    ],
  },
  'envelope.svg': {
    fail: [
      [
        'an svg with a child',
        withPage(
          '<svg data-icon="arrow-right" data-size="24"><path d="M0 0"/></svg>',
          'statement',
        ),
      ],
      [
        'an svg with text',
        withPage('<svg data-icon="arrow-right" data-size="24">x</svg>'),
      ],
      ['an svg without data-icon', withPage('<svg data-size="24"></svg>')],
      [
        'an svg without data-size',
        withPage('<svg data-icon="arrow-right"></svg>'),
      ],
    ],
    pass: [
      [
        'an empty placeholder',
        withPage(
          '<svg class="i" data-icon="arrow-right" data-size="24"></svg>',
        ),
      ],
    ],
  },
  'envelope.css.syntax': {
    fail: [
      ['an unclosed block', { css: '.a { margin: 0;' }],
      ['an unparseable selector', { css: '.a > > .b { margin: 0; }' }],
    ],
    pass: [['well-formed CSS', {}]],
  },
  'envelope.css.url': {
    fail: [
      ['url()', { css: '.a { background: url(x.png); }' }],
      ['a quoted url()', { css: '.a { background: url( "x.png" ); }' }],
      [
        'a data: url()',
        { css: '.a { background: url(data:image/png;base64,AAAA); }' },
      ],
      ['url() in a custom property', { css: '.a { --bg: url(x.png); }' }],
      [
        'image-set()',
        { css: '.a { background-image: image-set("x.png" 1x); }' },
      ],
      [
        '-webkit-image-set()',
        { css: '.a { background-image: -webkit-image-set("x.png" 1x); }' },
      ],
    ],
    pass: [
      [
        'a string that only mentions url(',
        { css: '.a::after { content: "url(x)"; }' },
      ],
    ],
  },
  'envelope.css.import': {
    fail: [
      ['@import', { css: '@import "x.css";' }],
      ['@import url()', { css: '@import url(x.css);' }],
    ],
    pass: [['no @import', {}]],
  },
  'envelope.css.fontFace': {
    fail: [['@font-face', { css: "@font-face { font-family: 'X'; }" }]],
    pass: [['no @font-face', {}]],
  },
  'envelope.css.conditional': {
    fail: [
      ['@media', { css: '@media print { .a { margin: 0; } }' }],
      ['@supports', { css: '@supports (display: grid) { .a { margin: 0; } }' }],
      [
        '@container',
        { css: '@container (min-width: 1px) { .a { margin: 0; } }' },
      ],
    ],
    pass: [['unconditional CSS', {}]],
  },
  'envelope.css.page': {
    fail: [['@page', { css: '@page { margin: 0; }' }]],
    pass: [['no @page', {}]],
  },
  'envelope.css.animation': {
    fail: [
      ['@keyframes', { css: '@keyframes spin { to { opacity: 0; } }' }],
      ['animation', { css: '.a { animation: spin 1s; }' }],
      ['an animation longhand', { css: '.a { animation-duration: 1s; }' }],
      ['a prefixed animation', { css: '.a { -webkit-animation-name: spin; }' }],
      ['transition', { css: '.a { transition: opacity 1s; }' }],
      ['a transition longhand', { css: '.a { transition-delay: 1s; }' }],
    ],
    pass: [['transform', { css: '.a { transform: rotate(4deg); }' }]],
  },
  'envelope.css.position': {
    fail: [
      ['position: fixed', { css: '.a { position: fixed; }' }],
      ['position: sticky', { css: '.a { position: sticky; }' }],
      ['position: -webkit-sticky', { css: '.a { position: -webkit-sticky; }' }],
      ['an upper-case position', { css: '.a { position: FIXED; }' }],
      ['a position from a variable', { css: '.a { position: var(--p); }' }],
    ],
    pass: [['position: absolute', { css: '.a { position: absolute; }' }]],
  },
  'envelope.css.legacy': {
    fail: [
      ['expression()', { css: '.a { width: expression(alert(1)); }' }],
      ['behavior', { css: '.a { behavior: none; }' }],
      ['-moz-binding', { css: '.a { -moz-binding: none; }' }],
    ],
    pass: [['ordinary properties', { css: '.a { width: 100%; }' }]],
  },
  'envelope.css.important': {
    fail: [
      ['!important', { css: '.a { margin: 0 !important; }' }],
      ['! important', { css: '.a { margin: 0 ! important; }' }],
      ['!IMPORTANT', { css: '.a { margin: 0 !IMPORTANT; }' }],
      ['!important on a custom property', { css: '.a { --x: 1 !important; }' }],
    ],
    pass: [['no !important', {}]],
  },
  'envelope.css.pageSelector': {
    fail: [
      ['.page', { css: '.page { display: flex; }' }],
      ['.page:last-child', { css: '.page:last-child { display: flex; }' }],
      ['section', { css: 'section { display: flex; }' }],
      ['*', { css: '* { box-sizing: border-box; }' }],
      ['body > *', { css: 'body > * { display: flex; }' }],
    ],
    pass: [
      ['a descendant of a page', { css: '.page > div { display: flex; }' }],
      ['a pseudo-element of a page', { css: '.page::after { content: ""; }' }],
      [
        'a universal selector scoped inside a page',
        { css: '.page * { box-sizing: border-box; }' },
      ],
      ['html and body', { css: 'html, body { background: var(--ds-white); }' }],
      [
        'a sibling chain inside a page',
        { css: '.sheet > * + * { margin: 16px 0 0; }' },
      ],
    ],
  },
  'envelope.css.atRule': {
    fail: [
      ['@layer', { css: '@layer base { .a { margin: 0; } }' }],
      ['@namespace', { css: '@namespace svg "http://www.w3.org/2000/svg";' }],
    ],
    pass: [['plain rules', {}]],
  },

  'page.pages': {
    fail: [
      [
        'too many pages',
        { pages: [TITLE, ...Array<string>(14).fill(page('<p>x</p>')), END] },
      ],
    ],
    pass: [
      [
        'the maximum',
        { pages: [TITLE, ...Array<string>(13).fill(page('<p>x</p>')), END] },
      ],
    ],
  },
  'page.background': {
    fail: [
      [
        'a :root without the page background token',
        candidate().replace('  --ds-white: #ffffff;\n', ''),
      ],
    ],
    pass: [['a :root with it', {}]],
  },
  'palette.tokens': {
    fail: [
      [
        'a token with the wrong hex',
        candidate().replace('--ds-ink: #0a0a0a', '--ds-ink: #000000'),
      ],
      ['an unknown token in :root', { css: ':root { --ds-blue: #0000ff; }' }],
      [
        'a reference to an unknown token',
        { css: '.a { color: var(--ds-blue); }' },
      ],
      [
        'a reference to an undeclared token',
        candidate({
          css: '.a { border-top: 2px solid var(--ds-hairline); }',
        }).replace('  --ds-hairline: #e2e2e2;\n', ''),
      ],
    ],
    pass: [
      [
        'an upper-case hex for a token',
        candidate().replace('#0a0a0a', '#0A0A0A'),
      ],
    ],
  },
  'palette.rules.references': {
    fail: [
      ['a token hex outside :root', { css: '.a { color: #0a0a0a; }' }],
      ['a short hex that expands to a token', { css: '.a { color: #fff; }' }],
      [
        'a token hex in a :root custom property',
        { css: ':root { --brand: #0a0a0a; }' },
      ],
      ['a token hex in a :root property', { css: ':root { color: #0a0a0a; }' }],
    ],
    pass: [['a var() reference', { css: '.a { color: var(--ds-ink); }' }]],
  },
  'palette.rules.externalColors': {
    fail: [
      ['an off-palette hex', { css: '.a { color: #123456; }' }],
      ['a short hex', { css: '.a { color: #123; }' }],
      ['a named colour', { css: '.a { border: 2px solid red; }' }],
      ['rgb()', { css: '.a { color: rgb(0 0 0); }' }],
      ['hsl()', { css: '.a { color: hsl(0 0% 0%); }' }],
      ['oklch()', { css: '.a { color: oklch(0.5 0.1 120); }' }],
      ['a system colour', { css: '.a { color: Canvas; }' }],
      ['a named colour in a custom property', { css: '.a { --c: tomato; }' }],
      ['an off-palette hex in :root', { css: ':root { --brand: #123456; }' }],
    ],
    pass: [
      [
        'currentColor, transparent and color-mix of tokens',
        {
          css: '.a { color: currentColor; background: transparent; border-color: color-mix(in srgb, var(--ds-ink) 50%, transparent); }',
        },
      ],
    ],
  },
  'typography.fonts': {
    fail: [
      ['an undeclared family', { css: '.a { font-family: Georgia, serif; }' }],
      ['a generic family first', { css: '.a { font-family: sans-serif; }' }],
      [
        'an undeclared family in font',
        { css: '.a { font: 500 48px/1.15 Arial, sans-serif; }' },
      ],
      ['a system font', { css: '.a { font: caption; }' }],
      [
        'a weight the family does not ship',
        { css: '.a { font-weight: 700; }' },
      ],
      ['bold', { css: '.a { font-weight: bold; }' }],
      ['an unshipped style', { css: '.a { font-style: italic; }' }],
    ],
    pass: [
      [
        'declared family, weight and style',
        {
          css: '.a { font-family: "inter tight", sans-serif; font-weight: normal; font-style: normal; }\n.b { font: 500 48px/1.15 \'Inter Tight\', sans-serif; }',
        },
      ],
    ],
  },
  'typography.scale': {
    fail: [
      ['a px value off the scale', { css: '.a { font-size: 41px; }' }],
      ['rem', { css: '.a { font-size: 2rem; }' }],
      ['a percentage', { css: '.a { font-size: 120%; }' }],
      ['a keyword', { css: '.a { font-size: large; }' }],
      ['var()', { css: '.a { font-size: var(--size); }' }],
      ['calc()', { css: '.a { font-size: calc(24px * 2); }' }],
      [
        'off the scale in font',
        { css: ".a { font: 500 50px 'Inter Tight'; }" },
      ],
    ],
    pass: [
      [
        'scale steps and inherit',
        {
          css: ".a { font-size: 48px; }\n.b { font-size: inherit; }\n.c { font: 30px/1.45 'Inter Tight'; }",
        },
      ],
    ],
  },
  'typography.rules.minPx': {
    fail: [
      ['a size below the floor', { css: '.a { font-size: 12px; }' }],
      [
        'a size below the floor in font',
        { css: ".a { font: 12px 'Inter Tight'; }" },
      ],
    ],
    pass: [['the floor itself', { css: '.a { font-size: 24px; }' }]],
  },
  'typography.rules.transforms': {
    fail: [
      [
        'a transform the system does not allow',
        { css: '.a { text-transform: uppercase; }' },
      ],
    ],
    pass: [['none', { css: '.a { text-transform: none; }' }]],
  },
  'spacing.scale': {
    fail: [
      ['a px value off the scale', { css: '.a { margin: 33px; }' }],
      ['rem', { css: '.a { padding: 1rem; }' }],
      ['a percentage', { css: '.a { gap: 10%; }' }],
      ['a negative step', { css: '.a { margin-top: -32px; }' }],
      ['calc()', { css: '.a { padding-inline: calc(8px * 2); }' }],
      ['var()', { css: '.a { row-gap: var(--g); }' }],
      ['one bad part of a shorthand', { css: '.a { padding: 32px 30px 0; }' }],
    ],
    pass: [
      [
        'steps, zero and auto',
        {
          css: '.a { margin: 0 auto; padding: 32px 0 0; gap: 48px 16px; margin-block-start: 0px; }',
        },
      ],
    ],
  },
  'icons.allowed': {
    fail: [
      [
        'an icon the system does not allow',
        withPage('<svg data-icon="check" data-size="24"></svg>'),
      ],
    ],
    pass: [
      [
        'an allowed icon',
        withPage('<svg data-icon="arrow-right" data-size="24"></svg>'),
      ],
    ],
  },
  'icons.sizes': {
    fail: [
      [
        'a size the system does not allow',
        withPage('<svg data-icon="arrow-right" data-size="32"></svg>'),
      ],
      [
        'a size with a unit',
        withPage('<svg data-icon="arrow-right" data-size="24px"></svg>'),
      ],
    ],
    pass: [
      [
        'an allowed size',
        withPage('<svg data-icon="arrow-right" data-size="24"></svg>'),
      ],
    ],
  },
  'icons.rules.maxPerPage': {
    fail: [
      [
        'more icons on a page than allowed',
        withPage(
          '<svg data-icon="arrow-right" data-size="24"></svg><svg data-icon="arrow-right" data-size="24"></svg>',
        ),
      ],
    ],
    pass: [
      [
        'the maximum',
        withPage('<svg data-icon="arrow-right" data-size="24"></svg>'),
      ],
    ],
  },
  'composition.pageRoles': {
    fail: [
      ['an unknown role', withPage('<p>x</p>', 'cover')],
      [
        'a page without data-role',
        { pages: [TITLE, '<section class="page"><p>x</p></section>', END] },
      ],
      ['an empty data-role', withPage('<p>x</p>', '')],
      ['a role pinned first on another page', { pages: [TITLE, TITLE, END] }],
      ['a role pinned last on another page', { pages: [TITLE, END, END] }],
      ['a required role on no page', { pages: [page('<p>x</p>'), END] }],
    ],
    pass: [
      [
        'every role in place',
        { pages: [TITLE, page('<p>x</p>'), page('<p>y</p>', 'list'), END] },
      ],
    ],
  },
};

const sourceOf = (parts: Parts | string) =>
  typeof parts === 'string' ? parts : candidate(parts);

describe('check', () => {
  it('should find nothing when the candidate conforms', () => {
    expect(check(margin, candidate())).toEqual([]);
  });

  describe.each(Object.entries(fixtures))('%s', (code, { fail, pass }) => {
    it.each(fail)('should report it when %s', (_, parts) => {
      expect(codesOf(sourceOf(parts))).toEqual([code]);
    });

    it.each(pass)('should accept %s', (_, parts) => {
      expect(codesOf(sourceOf(parts))).toEqual([]);
    });
  });

  it('should report every violation at once when there are several', () => {
    const codes = codesOf(
      candidate({
        css: '.a { font-size: 41px; margin: 33px; color: red; }',
        ...withPage('<img src="x.png"><p id="a">x</p>'),
      }),
    );

    expect(codes).toEqual(
      expect.arrayContaining([
        'typography.scale',
        'spacing.scale',
        'palette.rules.externalColors',
        'envelope.element',
        'envelope.attribute',
      ]),
    );
  });

  it('should report a markup violation with its page and line', () => {
    const source = candidate(withPage('<p id="a">x</p>'));
    const line = source.split('\n').findIndex((l) => l.includes('id="a"')) + 1;

    expect(check(margin, source)).toEqual([
      expect.objectContaining({ code: 'envelope.attribute', page: 2, line }),
    ]);
  });

  it('should report a CSS violation with its line in the candidate', () => {
    const source = candidate({
      css: '.a {\n  margin: 0;\n  font-size: 41px;\n}',
    });
    const line = source.split('\n').findIndex((l) => l.includes('41px')) + 1;

    expect(check(margin, source)).toEqual([
      expect.objectContaining({ code: 'typography.scale', line }),
    ]);
  });

  it('should name the offending value in the detail', () => {
    const [violation] = check(
      margin,
      candidate({ css: '.a { font-size: 41px; }' }),
    );

    expect(violation.detail).toContain('41px');
  });

  it('should ignore comments in markup and CSS', () => {
    expect(
      codesOf(
        candidate({
          css: '/* .page { display: flex; } url(x) */',
          ...withPage('<!-- <img src="x.png"> --><p>x</p>'),
          body: '<!-- loose comment -->\n',
        }),
      ),
    ).toEqual([]);
  });

  it('should only report truncation when the input is cut off', () => {
    expect(
      codesOf(candidate({ css: '.a { color: red; }' }).slice(0, -40)),
    ).toEqual(['envelope.truncated']);
  });

  it('should report too few pages when below the minimum', () => {
    const definition: DesignSystemDefinition = {
      ...margin,
      page: { ...margin.page, pages: { min: 3, max: 15 } },
    };

    expect(codesOf(candidate(), definition)).toEqual(['page.pages']);
  });

  it('should enforce the transforms the definition allows', () => {
    const definition: DesignSystemDefinition = {
      ...margin,
      typography: {
        ...margin.typography,
        rules: {
          ...margin.typography.rules,
          transforms: ['none', 'uppercase'],
        },
      },
    };
    const source = candidate({
      css: '.a { text-transform: uppercase; }\n.b { text-transform: lowercase; }',
    });

    expect(codesOf(source, definition)).toEqual([
      'typography.rules.transforms',
    ]);
  });

  /** §11.2: each bypass asserts its exact code. */
  describe('checker-bypass corpus', () => {
    it.each<[string, Parts | string, string[]]>([
      [
        'url( behind a CSS hex escape',
        { css: '.a { background: u\\72l(x.png); }' },
        ['envelope.css.url'],
      ],
      [
        'url( behind a padded hex escape',
        { css: '.a { background: u\\000072 l(x.png); }' },
        ['envelope.css.url'],
      ],
      [
        'url( behind an identity escape',
        { css: '.a { background: \\url(x.png); }' },
        ['envelope.css.url'],
      ],
      [
        'url( in upper case',
        { css: '.a { background: URL(x.png); }' },
        ['envelope.css.url'],
      ],
      [
        'url( after a comment',
        { css: '.a { background:/**/url(x.png); }' },
        ['envelope.css.url'],
      ],
      [
        'url( with a comment inside',
        { css: '.a { background: url(/**/x.png); }' },
        ['envelope.css.url'],
      ],
      [
        'image-set in mixed case',
        { css: '.a { background: Image-Set("x.png" 1x); }' },
        ['envelope.css.url'],
      ],
      [
        '@import in upper case',
        { css: '@IMPORT "x.css";' },
        ['envelope.css.import'],
      ],
      // postcss cannot read an escaped at-rule name, so it is rejected unread.
      [
        '@import behind an escape',
        { css: '@\\69mport "x.css";' },
        ['envelope.css.syntax'],
      ],
      [
        '.page via :is()',
        { css: ':is(.page, .x) { display: flex; }' },
        ['envelope.css.pageSelector'],
      ],
      [
        '.page via :where()',
        { css: ':where(section) { display: flex; }' },
        ['envelope.css.pageSelector'],
      ],
      [
        '.page via [class~=page]',
        { css: '[class~=page] { display: flex; }' },
        ['envelope.css.pageSelector'],
      ],
      [
        '.page via [data-role]',
        { css: '[data-role="title"] { display: flex; }' },
        ['envelope.css.pageSelector'],
      ],
      [
        '.page via section',
        { css: 'body section { display: flex; }' },
        ['envelope.css.pageSelector'],
      ],
      [
        '.page via body > *',
        { css: 'body > * { display: flex; }' },
        ['envelope.css.pageSelector'],
      ],
      [
        '.page via *',
        { css: '*, *::before { margin: 0; }' },
        ['envelope.css.pageSelector'],
      ],
      [
        '.page via html *',
        { css: 'html * { margin: 0; }' },
        ['envelope.css.pageSelector'],
      ],
      [
        '.page via :root > body > section',
        { css: ':root > body > section { margin: 0; }' },
        ['envelope.css.pageSelector'],
      ],
      [
        '.page via :not()',
        { css: 'body > :not(p) { margin: 0; }' },
        ['envelope.css.pageSelector'],
      ],
      [
        '.page via an escaped class',
        { css: '.p\\61 ge { margin: 0; }' },
        ['envelope.css.pageSelector'],
      ],
      [
        '.page via a sibling',
        { css: 'section + section { margin: 0; }' },
        ['envelope.css.pageSelector'],
      ],
      [
        '.page via nesting with &',
        { css: 'body { & > section { margin: 0; } }' },
        ['envelope.css.pageSelector'],
      ],
      [
        '.page via implicit nesting',
        { css: 'body { > * { margin: 0; } }' },
        ['envelope.css.pageSelector'],
      ],
      [
        '!important behind an escape',
        { css: '.a { margin: 0 !imp\\6frtant; }' },
        ['envelope.css.important'],
      ],
      [
        '!important behind a comment',
        { css: '.a { margin: 0 !/**/important; }' },
        ['envelope.css.important'],
      ],
      [
        '</style> inside a CSS string',
        { css: '.a::after { content: "</style><script>alert(1)</script>"; }' },
        ['envelope.head', 'envelope.body', 'envelope.css.syntax'],
      ],
      [
        'an svg with children',
        withPage(
          '<svg data-icon="arrow-right" data-size="24"><circle r="4"/></svg>',
        ),
        ['envelope.svg'],
      ],
      [
        'an svg <foreignObject>',
        withPage(
          '<svg data-icon="arrow-right" data-size="24"><foreignObject><p>x</p></foreignObject></svg>',
        ),
        ['envelope.svg'],
      ],
      [
        'a <script> inside svg',
        withPage(
          '<svg data-icon="arrow-right" data-size="24"><script>alert(1)</script></svg>',
        ),
        ['envelope.svg'],
      ],
      [
        'CDATA inside svg',
        withPage(
          '<svg data-icon="arrow-right" data-size="24"><![CDATA[x]]></svg>',
        ),
        ['envelope.svg'],
      ],
      [
        'on* in mixed case',
        withPage('<p oNcLiCk="alert(1)">x</p>'),
        ['envelope.attribute'],
      ],
      [
        'an entity-encoded attribute name',
        withPage('<p &#111;nclick="alert(1)">x</p>'),
        ['envelope.attribute'],
      ],
      [
        'an unquoted on* attribute',
        withPage('<p onload=alert(1)>x</p>'),
        ['envelope.attribute'],
      ],
      [
        'a nested <section>',
        withPage('<section class="page" data-role="statement">x</section>'),
        ['envelope.element'],
      ],
      [
        'a <template>',
        withPage('<template><img src="x.png"></template>'),
        ['envelope.element'],
      ],
      [
        'an element hidden in a comment trick',
        withPage('<!--><img src="x.png">-->'),
        ['envelope.element'],
      ],
      [
        'nothing when CDATA outside svg is only a comment',
        withPage('<![CDATA[<img src="x.png">]]>'),
        [],
      ],
      [
        'a source of 256 KB plus one byte',
        'x'.repeat(CANDIDATE_SOURCE_MAX_BYTES + 1),
        ['envelope.truncated'],
      ],
      [
        'unclosed input',
        candidate().replace('</body>\n</html>\n', ''),
        ['envelope.truncated'],
      ],
    ])('should report %s', (_, parts, codes) => {
      expect(codesOf(sourceOf(parts))).toEqual(codes);
    });

    it('should accept a source at exactly 256 KB', () => {
      const base = candidate();
      const pad = CANDIDATE_SOURCE_MAX_BYTES - Buffer.byteLength(base);
      const source = base.replace(
        '</body>',
        `<!--${'x'.repeat(pad - 8)}-->\n</body>`,
      );

      expect(Buffer.byteLength(source)).toBe(CANDIDATE_SOURCE_MAX_BYTES);
      expect(codesOf(source)).toEqual([]);
    });
  });
});
