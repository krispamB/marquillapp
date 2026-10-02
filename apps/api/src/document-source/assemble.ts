import {
  defaultTreeAdapter,
  html,
  parse,
  serialize,
  type DefaultTreeAdapterMap,
} from 'parse5';
import type { DesignSystemDefinition } from '../design-system/design-system-definition';
import { DESIGN_SYSTEM_FONT_ALLOWLIST } from '../design-system/design-system.constants';
import { catalogIcon } from '../design-system/icon-catalog';
import { IconInliningError } from './icon-inlining.error';

type Element = DefaultTreeAdapterMap['element'];
type ParentNode = DefaultTreeAdapterMap['parentNode'];

const FONT_STYLESHEET = 'https://fonts.googleapis.com/css2';
const FONT_FILES_ORIGIN = 'https://fonts.gstatic.com';

/**
 * The frame (§4.3): page geometry and pagination, derived from the definition.
 * It never sets `display` or anything typographic; the model composes inside
 * the page, and a model-authored `.page` rule is already a static violation.
 */
export function frameCss(definition: DesignSystemDefinition): string {
  const { width, height, safeArea, background } = definition.page;
  return [
    'html, body { margin: 0; padding: 0; }',
    // `contain: strict` makes each page the containing block for positioned
    // descendants and stops print fragmentation from carrying them onto
    // another sheet (#137).
    `.page { width: ${width}px; height: ${height}px; box-sizing: border-box; ` +
      `padding: ${safeArea.top}px ${safeArea.right}px ${safeArea.bottom}px ${safeArea.left}px; ` +
      `background: var(--ds-${background}); overflow: hidden; overflow-wrap: break-word; ` +
      'break-after: page; contain: strict; }',
    '.page:last-child { break-after: auto; }',
  ].join('\n');
}

/**
 * The Google Fonts stylesheet for `typography.fonts` ∩
 * `DESIGN_SYSTEM_FONT_ALLOWLIST`. `display=block`: a PDF is one frame, so a
 * fallback face must never paint during a swap period.
 */
export function fontStylesheetUrl(
  definition: DesignSystemDefinition,
): string | undefined {
  const families = definition.typography.fonts
    .filter(
      (font) =>
        font.source === 'google' &&
        DESIGN_SYSTEM_FONT_ALLOWLIST.includes(font.family),
    )
    .map((font) => {
      const name = font.family.replace(/ /g, '+');
      const weights = [...font.weights].sort((a, b) => a - b);
      if (!font.styles.includes('italic')) {
        return `family=${name}:wght@${weights.join(';')}`;
      }
      // Google requires the tuples sorted: upright before italic.
      const axes = [
        ...new Set(font.styles.map((style) => (style === 'italic' ? 1 : 0))),
      ]
        .sort()
        .flatMap((ital) => weights.map((weight) => `${ital},${weight}`));
      return `family=${name}:ital,wght@${axes.join(';')}`;
    });
  return families.length > 0
    ? `${FONT_STYLESHEET}?${families.join('&')}&display=block`
    : undefined;
}

/**
 * The only requests a Document Source may make while rendering: the font
 * stylesheet and the font files it references. The `url(` prohibition binds
 * the Candidate Source only; Google's stylesheet legitimately loads from
 * `fonts.gstatic.com`, which must never be blocked (§4.5).
 */
export function isFontRequest(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.origin === FONT_FILES_ORIGIN ||
    `${parsed.origin}${parsed.pathname}` === FONT_STYLESHEET
  );
}

const elementsOf = (node: ParentNode): Element[] =>
  node.childNodes.flatMap((child) =>
    'tagName' in child ? [child, ...elementsOf(child)] : [],
  );

const attributeOf = (element: Element, name: string) =>
  element.attrs.find((attr) => attr.name === name)?.value;

const isPlaceholder = (element: Element) =>
  element.tagName === 'svg' &&
  element.namespaceURI === html.NS.SVG &&
  attributeOf(element, 'data-icon') !== undefined;

const isUnfilled = (element: Element) =>
  isPlaceholder(element) &&
  !element.childNodes.some((child) => 'tagName' in child);

function inlineIcon(svg: Element): void {
  const name = attributeOf(svg, 'data-icon')!;
  const size = attributeOf(svg, 'data-size') ?? '';
  const nodes = catalogIcon(name);
  if (!nodes || nodes.length === 0) {
    throw new IconInliningError(`icon "${name}" is not in the icon catalog`);
  }
  if (!/^[1-9]\d*$/.test(size)) {
    throw new IconInliningError(`icon "${name}" has an invalid size "${size}"`);
  }

  svg.attrs = [
    ...svg.attrs.filter((attr) =>
      ['class', 'data-icon', 'data-size'].includes(attr.name),
    ),
    { name: 'viewBox', value: '0 0 24 24' },
    { name: 'width', value: size },
    { name: 'height', value: size },
    { name: 'fill', value: 'none' },
    { name: 'stroke', value: 'currentColor' },
    { name: 'stroke-width', value: '2' },
    { name: 'stroke-linecap', value: 'round' },
    { name: 'stroke-linejoin', value: 'round' },
    { name: 'aria-hidden', value: 'true' },
    { name: 'focusable', value: 'false' },
  ];
  svg.childNodes = [];
  for (const [tag, attrs] of nodes) {
    defaultTreeAdapter.appendChild(
      svg,
      defaultTreeAdapter.createElement(
        tag,
        html.NS.SVG,
        Object.entries(attrs).map(([attrName, value]) => ({
          name: attrName,
          value,
        })),
      ),
    );
  }
}

/** Throws unless every icon placeholder in a Document Source has content. */
export function assertIconsFilled(documentSource: string): void {
  const unfilled = elementsOf(parse(documentSource)).filter(isUnfilled);
  if (unfilled.length > 0) {
    throw new IconInliningError(
      `${unfilled.length} icon placeholder(s) left unfilled after assembly`,
    );
  }
}

/**
 * Turns a statically clean Candidate Source into a Document Source (§4.5) by
 * adding exactly three derived things: the frame stylesheet, the Google Fonts
 * link, and the inlined icons. Pure and deterministic.
 */
export function assemble(
  definition: DesignSystemDefinition,
  candidate: string,
): string {
  const document = parse(candidate);
  const all = elementsOf(document);
  const head = all.find((element) => element.tagName === 'head')!;

  const href = fontStylesheetUrl(definition);
  if (href) {
    defaultTreeAdapter.appendChild(
      head,
      defaultTreeAdapter.createElement('link', html.NS.HTML, [
        { name: 'rel', value: 'stylesheet' },
        { name: 'href', value: href },
      ]),
    );
  }
  // Last in <head>, so the frame wins the cascade at equal specificity.
  const frame = defaultTreeAdapter.createElement('style', html.NS.HTML, []);
  defaultTreeAdapter.insertText(frame, frameCss(definition));
  defaultTreeAdapter.appendChild(head, frame);

  for (const svg of all.filter(isPlaceholder)) inlineIcon(svg);

  const documentSource = serialize(document);
  assertIconsFilled(documentSource);
  return documentSource;
}
