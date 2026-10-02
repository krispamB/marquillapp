import { html as parse5Html, parse, type DefaultTreeAdapterMap } from 'parse5';
import postcss, {
  type AtRule,
  type ChildNode,
  CssSyntaxError,
  type Declaration,
  type Rule,
} from 'postcss';
import type { DesignSystemDefinition } from '../design-system/design-system-definition';
import { COLOR_FUNCTIONS, NAMED_COLORS, SYSTEM_COLORS } from './css-colors';
import {
  ComplexSelector,
  parseSelectorList,
  selectorMayMatch,
} from './css-selectors';
import {
  CssToken,
  decodeCssName,
  lowerAscii,
  splitTopLevel,
  tokenizeCss,
  trimTokens,
} from './css-tokens';
import { CANDIDATE_SOURCE_MAX_BYTES } from './document-source.constants';
import type { Violation } from './violation';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
type Document = DefaultTreeAdapterMap['document'];
type TextNode = DefaultTreeAdapterMap['textNode'];

const HTML_NS = parse5Html.NS.HTML;
const SVG_NS = parse5Html.NS.SVG;

/** Elements allowed inside a page (§4.2), besides the `<svg>` placeholder. */
const PAGE_CONTENT = new Set([
  'div',
  'header',
  'footer',
  'figure',
  'figcaption',
  'blockquote',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'span',
  'strong',
  'em',
  'small',
  'q',
  'cite',
  'sup',
  'sub',
  'br',
  'hr',
]);

const CSS_WIDE = new Set([
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
]);
const CONDITIONAL_AT_RULES = new Set(['media', 'supports', 'container']);
const KEYFRAMES = new Set(['keyframes', '-webkit-keyframes', '-moz-keyframes']);
const LEGACY_PROPERTIES = new Set(['behavior', '-ms-behavior', '-moz-binding']);
const FETCHING_FUNCTIONS = new Set(['url', 'image-set', '-webkit-image-set']);
const SYSTEM_FONTS = new Set([
  'caption',
  'icon',
  'menu',
  'message-box',
  'small-caption',
  'status-bar',
]);
const FONT_SIZE_KEYWORDS = new Set([
  'xx-small',
  'x-small',
  'small',
  'medium',
  'large',
  'x-large',
  'xx-large',
  'xxx-large',
  'smaller',
  'larger',
  'math',
]);
const GAP_PROPERTIES = new Set([
  'gap',
  'row-gap',
  'column-gap',
  'grid-gap',
  'grid-row-gap',
  'grid-column-gap',
]);
const VENDOR_PREFIXES = ['-webkit-', '-moz-', '-ms-', '-o-'];

const isElement = (node: Node): node is Element => 'tagName' in node;
const isText = (node: Node): node is TextNode => node.nodeName === '#text';
const isBlank = (text: string) => text.trim() === '';

const attributeOf = (element: Element, name: string) =>
  element.attrs.find((attr) => attr.name === name)?.value;

const lineOf = (element: Element, attribute?: string) =>
  (attribute && element.sourceCodeLocation?.attrs?.[attribute]?.startLine) ||
  element.sourceCodeLocation?.startLine;

const snippet = (text: string) => {
  const flat = text.trim().replace(/\s+/g, ' ');
  return flat.length > 40 ? `${flat.slice(0, 40)}…` : flat;
};

const withoutVendorPrefix = (property: string) => {
  const prefix = VENDOR_PREFIXES.find((p) => property.startsWith(p));
  return prefix ? property.slice(prefix.length) : property;
};

/** `#abc` → `#aabbcc`, lower case; `undefined` when not a colour. */
const expandHex = (hash: string): string | undefined => {
  const hex = lowerAscii(hash);
  if (![3, 4, 6, 8].includes(hex.length)) return undefined;
  for (const c of hex) {
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return undefined;
  }
  return hex.length <= 4
    ? `#${[...hex].map((c) => c + c).join('')}`
    : `#${hex}`;
};

const significant = (tokens: CssToken[]) =>
  tokens.filter((token) => token.type !== 'whitespace');

const isIdent = (token: CssToken | undefined, ...values: string[]) =>
  token?.type === 'ident' &&
  (values.length === 0 || values.includes(token.lower));

/** The first family of a `font-family` list, lower case; `undefined` if not literal. */
const firstFamily = (tokens: CssToken[]): string | undefined => {
  const first = significant(splitTopLevel(tokens)[0] ?? []);
  if (first.length === 1 && first[0].type === 'string')
    return lowerAscii(first[0].value);
  if (first.length > 0 && first.every((token) => token.type === 'ident'))
    return first.map((token) => (token as { lower: string }).lower).join(' ');
  return undefined;
};

/**
 * Validates a Candidate Source against the structural allowlist grammar and
 * CSS prohibitions (§4.2) and the Design System's static-check keys (§3.1).
 * Pure: no I/O, every violation at once, and it never sanitizes (§4.4).
 */
export function check(
  definition: DesignSystemDefinition,
  candidate: string,
): Violation[] {
  const bytes = Buffer.byteLength(candidate, 'utf8');
  if (bytes > CANDIDATE_SOURCE_MAX_BYTES) {
    return [
      {
        code: 'envelope.truncated',
        detail: `the document is ${bytes} bytes; the limit is ${CANDIDATE_SOURCE_MAX_BYTES}`,
      },
    ];
  }
  return new CandidateChecker(definition).run(candidate);
}

interface Icon {
  name: string;
  size: string;
  line?: number;
}

class CandidateChecker {
  private readonly violations: Violation[] = [];
  private readonly pages: Element[] = [];
  private readonly icons: Icon[][] = [];
  private readonly tokenHex: Map<string, string>;
  private readonly hexToken: Map<string, string>;
  private readonly families: Set<string>;
  private readonly weights: Set<number>;
  private readonly italic: boolean;
  /** `--ds-*` tokens declared in `:root`. */
  private readonly declared = new Set<string>();
  /** `var(--ds-*)` references, by token name, with the first line seen. */
  private readonly referenced = new Map<string, number | undefined>();
  /** Palette findings are meaningless when part of the CSS was never read. */
  private cssUnparsed = false;

  constructor(private readonly definition: DesignSystemDefinition) {
    const { tokens } = definition.palette;
    this.tokenHex = new Map(tokens.map((t) => [t.name, lowerAscii(t.hex)]));
    this.hexToken = new Map(tokens.map((t) => [lowerAscii(t.hex), t.name]));
    const { fonts } = definition.typography;
    this.families = new Set(fonts.map((f) => lowerAscii(f.family)));
    this.weights = new Set(fonts.flatMap((f) => f.weights));
    this.italic = fonts.some((f) => f.styles.includes('italic'));
  }

  private add(
    code: string,
    detail: string,
    at: { page?: number; line?: number } = {},
  ) {
    const violation: Violation = { code, detail };
    if (at.page !== undefined) violation.page = at.page;
    if (at.line !== undefined) violation.line = at.line;
    this.violations.push(violation);
  }

  run(candidate: string): Violation[] {
    const eofErrors: string[] = [];
    const document = parse(candidate, {
      sourceCodeLocationInfo: true,
      onParseError: (error) => {
        if (error.code.startsWith('eof-')) eofErrors.push(error.code);
      },
    });
    const html = document.childNodes.find(isElement)!;
    const head = html.childNodes.find(
      (n) => isElement(n) && n.tagName === 'head',
    ) as Element;
    const body = html.childNodes.find(
      (n) => isElement(n) && n.tagName === 'body',
    ) as Element;

    // A cut-off output never reaches its final end tag. Other violations in a
    // truncated document are noise, so truncation is reported alone.
    const closer = html.sourceCodeLocation ? html : body;
    if (eofErrors.length > 0 || !closer.sourceCodeLocation?.endTag) {
      return [
        {
          code: 'envelope.truncated',
          detail: 'the document is cut off; it must end with </html>',
        },
      ];
    }

    this.checkDocument(document, html, head, body);
    const styles = this.checkHead(head);
    this.checkBody(body);
    this.checkComposition();
    for (const style of styles) this.checkStyle(style);
    if (!this.cssUnparsed) this.checkPalette();
    return this.violations;
  }

  private checkDocument(
    document: Document,
    html: Element,
    head: Element,
    body: Element,
  ) {
    const doctype = document.childNodes.find(
      (n) => n.nodeName === '#documentType',
    );
    if (!doctype || document.mode !== parse5Html.DOCUMENT_MODE.NO_QUIRKS) {
      this.add(
        'envelope.document',
        'the document must start with <!doctype html>',
      );
    }
    if (!html.sourceCodeLocation) {
      this.add(
        'envelope.document',
        'the document must have an explicit <html> element',
      );
    }
    for (const attr of html.attrs) {
      if (attr.name !== 'lang') {
        this.add(
          'envelope.document',
          `<html> may only carry lang, not ${attr.name}`,
          {
            line: lineOf(html, attr.name),
          },
        );
      }
    }
    for (const attr of head.attrs) {
      this.add(
        'envelope.head',
        `<head> takes no attributes; found ${attr.name}`,
        {
          line: lineOf(head, attr.name),
        },
      );
    }
    for (const attr of body.attrs) {
      this.add(
        'envelope.body',
        `<body> takes no attributes; found ${attr.name}`,
        {
          line: lineOf(body, attr.name),
        },
      );
    }
  }

  /** Returns the `<style>` elements whose CSS is checked. */
  private checkHead(head: Element): Element[] {
    const styles: Element[] = [];
    let charsets = 0;
    let titles = 0;

    for (const node of head.childNodes) {
      if (!isElement(node)) continue;
      const line = lineOf(node);
      switch (node.tagName) {
        case 'meta': {
          const charset = attributeOf(node, 'charset');
          if (node.attrs.length !== 1 || charset === undefined) {
            this.add(
              'envelope.head',
              'the only <meta> allowed is <meta charset="utf-8">',
              { line },
            );
          } else {
            charsets++;
            if (lowerAscii(charset) !== 'utf-8') {
              this.add(
                'envelope.head',
                `<meta charset="${charset}"> must be utf-8`,
                { line },
              );
            }
          }
          break;
        }
        case 'title':
          if (++titles > 1)
            this.add('envelope.head', '<head> may have at most one <title>', {
              line,
            });
          this.noAttributes(node, 'envelope.head');
          break;
        case 'style':
          styles.push(node);
          this.noAttributes(node, 'envelope.head');
          break;
        default:
          this.add(
            'envelope.head',
            `<${node.tagName}> is not allowed in <head>`,
            { line },
          );
      }
    }

    if (charsets === 0)
      this.add('envelope.head', '<head> must contain <meta charset="utf-8">');
    if (charsets > 1)
      this.add(
        'envelope.head',
        '<head> must contain exactly one <meta charset>',
      );
    if (styles.length !== 1) {
      this.add(
        'envelope.head',
        `<head> must contain exactly one <style>; found ${styles.length}`,
      );
    }
    return styles;
  }

  private noAttributes(element: Element, code: string) {
    for (const attr of element.attrs) {
      this.add(
        code,
        `<${element.tagName}> takes no attributes; found ${attr.name}`,
        {
          line: lineOf(element, attr.name),
        },
      );
    }
  }

  private checkBody(body: Element) {
    for (const node of body.childNodes) {
      if (isText(node)) {
        if (!isBlank(node.value)) {
          this.add(
            'envelope.body',
            `text outside a page: "${snippet(node.value)}"`,
            {
              line: node.sourceCodeLocation?.startLine,
            },
          );
        }
        continue;
      }
      if (!isElement(node)) continue;

      const classes = (attributeOf(node, 'class') ?? '')
        .split(/\s+/)
        .filter(Boolean);
      const isPage =
        node.tagName === 'section' &&
        node.namespaceURI === HTML_NS &&
        classes.length === 1 &&
        classes[0] === 'page';
      if (!isPage) {
        this.add(
          'envelope.body',
          node.tagName === 'section'
            ? 'a page is <section class="page" data-role="…"> with no other class'
            : `<${node.tagName}> is not a page; <body> holds only <section class="page" data-role="…">`,
          { line: lineOf(node) },
        );
        continue;
      }

      this.pages.push(node);
      this.icons.push([]);
      const page = this.pages.length;
      for (const attr of node.attrs) {
        if (attr.name !== 'class' && attr.name !== 'data-role') {
          this.add(
            'envelope.attribute',
            `a page may only carry class and data-role, not ${attr.name}`,
            {
              page,
              line: lineOf(node, attr.name),
            },
          );
        }
      }
      this.checkContent(node, page);
    }
  }

  private checkContent(parent: Element, page: number) {
    for (const node of parent.childNodes) {
      if (!isElement(node)) continue;
      const line = lineOf(node);

      if (node.namespaceURI === SVG_NS && node.tagName === 'svg') {
        this.checkIcon(node, page);
        continue;
      }
      if (node.namespaceURI !== HTML_NS || !PAGE_CONTENT.has(node.tagName)) {
        this.add(
          'envelope.element',
          node.tagName === 'section'
            ? 'pages cannot be nested'
            : `<${node.tagName}> is not allowed inside a page`,
          { page, line },
        );
        continue;
      }
      for (const attr of node.attrs) {
        if (attr.name !== 'class') {
          this.add(
            'envelope.attribute',
            `<${node.tagName}> may only carry class, not ${attr.name}`,
            {
              page,
              line: lineOf(node, attr.name),
            },
          );
        }
      }
      this.checkContent(node, page);
    }
  }

  private checkIcon(svg: Element, page: number) {
    const line = lineOf(svg);
    for (const attr of svg.attrs) {
      if (!['class', 'data-icon', 'data-size'].includes(attr.name)) {
        this.add(
          'envelope.attribute',
          `<svg> may only carry class, data-icon and data-size, not ${attr.name}`,
          {
            page,
            line: lineOf(svg, attr.name),
          },
        );
      }
    }
    const filled = svg.childNodes.some(
      (n) => isElement(n) || (isText(n) && !isBlank(n.value)),
    );
    if (filled) {
      this.add(
        'envelope.svg',
        '<svg> must be an empty placeholder; the app inlines the icon',
        { page, line },
      );
    }
    const name = attributeOf(svg, 'data-icon');
    const size = attributeOf(svg, 'data-size');
    if (name === undefined || size === undefined) {
      this.add('envelope.svg', '<svg> needs both data-icon and data-size', {
        page,
        line,
      });
      return;
    }
    this.icons[page - 1].push({ name, size, line });
  }

  private checkComposition() {
    const { pages: range } = this.definition.page;
    const count = this.pages.length;
    if (count < range.min || count > range.max) {
      this.add(
        'page.pages',
        `${count} pages; this design allows ${range.min} to ${range.max}`,
      );
    }

    const roles = this.definition.composition.pageRoles;
    const names = roles.map((role) => role.name);
    const used = new Set<string>();
    this.pages.forEach((element, i) => {
      const page = i + 1;
      const line = lineOf(element, 'data-role');
      const roleName = attributeOf(element, 'data-role');
      const role = roles.find((r) => r.name === roleName);
      if (!roleName || !role) {
        this.add(
          'composition.pageRoles',
          `${roleName ? `role "${roleName}" is not defined` : 'the page has no data-role'}; use one of: ${names.join(', ')}`,
          { page, line },
        );
        return;
      }
      used.add(role.name);
      if (role.position === 'first' && page !== 1) {
        this.add(
          'composition.pageRoles',
          `role "${role.name}" belongs on the first page only`,
          { page, line },
        );
      }
      if (role.position === 'last' && page !== count) {
        this.add(
          'composition.pageRoles',
          `role "${role.name}" belongs on the last page only`,
          { page, line },
        );
      }
    });
    for (const role of roles) {
      if (role.required && !used.has(role.name)) {
        const where =
          role.position === 'any' ? 'some page' : `the ${role.position} page`;
        this.add(
          'composition.pageRoles',
          `role "${role.name}" is required on ${where}`,
        );
      }
    }

    const { allowed, sizes, rules } = this.definition.icons;
    this.icons.forEach((icons, i) => {
      const page = i + 1;
      if (icons.length > rules.maxPerPage) {
        this.add(
          'icons.rules.maxPerPage',
          `${icons.length} icons on the page; at most ${rules.maxPerPage}`,
          { page },
        );
      }
      for (const icon of icons) {
        if (!allowed.includes(icon.name)) {
          this.add(
            'icons.allowed',
            `icon "${icon.name}" is not allowed; use one of: ${allowed.join(', ')}`,
            {
              page,
              line: icon.line,
            },
          );
        }
        const size = Number(icon.size);
        if (String(size) !== icon.size || !sizes.includes(size)) {
          this.add(
            'icons.sizes',
            `data-size="${icon.size}" is not allowed; use one of: ${sizes.join(', ')}`,
            {
              page,
              line: icon.line,
            },
          );
        }
      }
    });
  }

  private checkStyle(style: Element) {
    const text = style.childNodes.filter(isText);
    if (text.length === 0) return;
    const css = text.map((node) => node.value).join('');
    const offset = (text[0].sourceCodeLocation?.startLine ?? 1) - 1;

    let root: ReturnType<typeof postcss.parse>;
    try {
      root = postcss.parse(css);
    } catch (error) {
      if (!(error instanceof CssSyntaxError)) throw error;
      this.cssUnparsed = true;
      this.add(
        'envelope.css.syntax',
        `the CSS does not parse: ${error.reason}`,
        {
          line: error.line === undefined ? undefined : offset + error.line,
        },
      );
      return;
    }
    this.walk(root.nodes, offset, undefined);
  }

  private lineIn(node: ChildNode, offset: number) {
    const line = node.source?.start?.line;
    return line === undefined ? undefined : offset + line;
  }

  private walk(
    nodes: ChildNode[],
    offset: number,
    parent: ComplexSelector[] | undefined,
  ) {
    for (const node of nodes) {
      if (node.type === 'atrule') this.checkAtRule(node, offset, parent);
      else if (node.type === 'rule') this.checkRule(node, offset, parent);
      else if (node.type === 'decl') this.checkDeclaration(node, offset, false);
    }
  }

  private checkAtRule(
    atRule: AtRule,
    offset: number,
    parent: ComplexSelector[] | undefined,
  ) {
    const name = lowerAscii(decodeCssName(atRule.name));
    const line = this.lineIn(atRule, offset);
    if (name === 'import') {
      this.add(
        'envelope.css.import',
        '@import is not allowed; the document cannot fetch anything',
        { line },
      );
      return;
    }
    if (name === 'font-face') {
      this.add(
        'envelope.css.fontFace',
        "@font-face is not allowed; fonts come from the design's typography",
        { line },
      );
      return;
    }
    if (KEYFRAMES.has(name)) {
      this.add(
        'envelope.css.animation',
        `@${name} is not allowed; a PDF is a single frame`,
        { line },
      );
      return;
    }
    if (name === 'page') {
      this.add(
        'envelope.css.page',
        '@page is not allowed; the app sets the page box',
        { line },
      );
      return;
    }
    if (CONDITIONAL_AT_RULES.has(name)) {
      this.add(
        'envelope.css.conditional',
        `@${name} is not allowed; there is one device and one render`,
        { line },
      );
    } else {
      this.add('envelope.css.atRule', `@${name} is not allowed`, { line });
    }
    this.walk(atRule.nodes ?? [], offset, parent);
  }

  private checkRule(
    rule: Rule,
    offset: number,
    parent: ComplexSelector[] | undefined,
  ) {
    const line = this.lineIn(rule, offset);
    let selectors: ComplexSelector[] | undefined;
    try {
      selectors = parseSelectorList(rule.selector, parent);
    } catch {
      this.add(
        'envelope.css.syntax',
        `the selector "${snippet(rule.selector)}" does not parse`,
        { line },
      );
    }

    if (
      selectors?.some((selector) =>
        this.pages.some((page) => selectorMayMatch(selector, page)),
      )
    ) {
      this.add(
        'envelope.css.pageSelector',
        `"${snippet(rule.selector)}" matches a page element; the app styles .page, so lay out an element inside it`,
        { line },
      );
    }

    const isRoot = !parent && rule.selector.trim() === ':root';
    for (const node of rule.nodes) {
      if (node.type === 'decl') this.checkDeclaration(node, offset, isRoot);
    }
    this.walk(
      rule.nodes.filter((n) => n.type !== 'decl'),
      offset,
      selectors,
    );
  }

  private checkDeclaration(decl: Declaration, offset: number, isRoot: boolean) {
    const line = this.lineIn(decl, offset);
    const at = { line };
    const property = decl.prop.startsWith('--')
      ? decl.prop
      : lowerAscii(decodeCssName(decl.prop));
    const all = tokenizeCss(decl.value);
    const value = `${decl.prop}: ${snippet(decl.value)}`;

    // Envelope prohibitions (§4.2).
    const bang = all.findIndex(
      (t, i) =>
        t.type === 'delim' &&
        t.value === '!' &&
        isIdent(significant(all.slice(i + 1))[0], 'important'),
    );
    // An `!important` postcss did not recognise is still not part of the value.
    const tokens = bang === -1 ? all : all.slice(0, bang);
    if (decl.important || bang !== -1) {
      this.add(
        'envelope.css.important',
        `!important is not allowed (${value})`,
        at,
      );
    }
    if (
      tokens.some(
        (t) =>
          t.type === 'url' ||
          (t.type === 'function' && FETCHING_FUNCTIONS.has(t.lower)),
      )
    ) {
      this.add(
        'envelope.css.url',
        `url() and image-set() are not allowed; the document cannot fetch anything (${value})`,
        at,
      );
    }
    if (
      LEGACY_PROPERTIES.has(property) ||
      tokens.some((t) => t.type === 'function' && t.lower === 'expression')
    ) {
      this.add('envelope.css.legacy', `${value} is not allowed`, at);
    }
    const unprefixed = withoutVendorPrefix(property);
    if (
      unprefixed.startsWith('animation') ||
      unprefixed.startsWith('transition')
    ) {
      this.add(
        'envelope.css.animation',
        `${property} is not allowed; a PDF is a single frame`,
        at,
      );
    }
    if (property === 'position') {
      const position = significant(tokens);
      if (
        position.some(
          (t) =>
            t.type !== 'ident' ||
            ['fixed', 'sticky', '-webkit-sticky'].includes(t.lower),
        )
      ) {
        this.add(
          'envelope.css.position',
          `${value} is not allowed; use static, relative or absolute`,
          at,
        );
      }
    }

    // Design System static checks (§3.1).
    this.collectReferences(tokens, line);
    if (isRoot && property.startsWith('--ds-')) {
      this.checkTokenDeclaration(
        property.slice('--ds-'.length),
        tokens,
        value,
        line,
      );
      return;
    }
    this.checkColors(property, tokens, value, line);

    switch (property) {
      case 'font-size':
        this.checkFontSize(significant(tokens), value, line);
        break;
      case 'font':
        this.checkFontShorthand(tokens, value, line);
        break;
      case 'font-family':
        this.checkFamily(tokens, value, line);
        break;
      case 'font-weight':
        this.checkWeight(significant(tokens), value, line);
        break;
      case 'font-style':
        this.checkStyleKeyword(significant(tokens), value, line);
        break;
      case 'text-transform':
        this.checkTransform(significant(tokens), value, line);
        break;
    }
    this.checkSpacing(property, tokens, value, line);
  }

  private collectReferences(tokens: CssToken[], line: number | undefined) {
    tokens.forEach((token, i) => {
      if (token.type !== 'function' || token.lower !== 'var') return;
      const name = significant(tokens.slice(i + 1))[0];
      if (name?.type === 'ident' && name.value.startsWith('--ds-')) {
        const tokenName = name.value.slice('--ds-'.length);
        if (!this.referenced.has(tokenName))
          this.referenced.set(tokenName, line);
      }
    });
  }

  private checkTokenDeclaration(
    name: string,
    tokens: CssToken[],
    value: string,
    line: number | undefined,
  ) {
    const hex = this.tokenHex.get(name);
    if (hex === undefined) {
      this.add(
        'palette.tokens',
        `--ds-${name} is not a palette token; use one of: ${[...this.tokenHex.keys()].join(', ')}`,
        { line },
      );
      return;
    }
    this.declared.add(name);
    const parts = significant(tokens);
    const actual =
      parts.length === 1 && parts[0].type === 'hash'
        ? expandHex(parts[0].value)
        : undefined;
    if (actual !== hex) {
      this.add('palette.tokens', `--ds-${name} must be ${hex} (${value})`, {
        line,
      });
    }
  }

  private checkColors(
    property: string,
    tokens: CssToken[],
    value: string,
    line: number | undefined,
  ) {
    const scanKeywords = property !== 'font-family' && property !== 'font';
    for (const token of tokens) {
      if (token.type === 'hash') {
        const hex = expandHex(token.value);
        if (hex === undefined) continue;
        const name = this.hexToken.get(hex);
        if (name) {
          this.add(
            'palette.rules.references',
            `#${token.value} must be written var(--ds-${name}); hex belongs only in :root (${value})`,
            { line },
          );
        } else {
          this.add(
            'palette.rules.externalColors',
            `#${token.value} is not a palette colour (${value})`,
            { line },
          );
        }
      } else if (
        token.type === 'function' &&
        COLOR_FUNCTIONS.has(token.lower)
      ) {
        this.add(
          'palette.rules.externalColors',
          `${token.lower}() bypasses the palette; use var(--ds-<token>) (${value})`,
          { line },
        );
      } else if (
        scanKeywords &&
        token.type === 'ident' &&
        (NAMED_COLORS.has(token.lower) || SYSTEM_COLORS.has(token.lower))
      ) {
        this.add(
          'palette.rules.externalColors',
          `${token.value} is not a palette colour; use var(--ds-<token>) (${value})`,
          { line },
        );
      }
    }
  }

  private checkFontSize(
    tokens: CssToken[],
    value: string,
    line: number | undefined,
  ) {
    if (tokens.length === 1 && isIdent(tokens[0], ...CSS_WIDE)) return;
    const [size] = tokens;
    const { scale, rules } = this.definition.typography;
    const steps = scale.map((step) => step.px);
    if (
      tokens.length === 1 &&
      size.type === 'dimension' &&
      size.unit === 'px'
    ) {
      if (size.value < rules.minPx) {
        this.add(
          'typography.rules.minPx',
          `${size.value}px is below the ${rules.minPx}px floor (${value})`,
          { line },
        );
        return;
      }
      if (steps.includes(size.value)) return;
    }
    this.add(
      'typography.scale',
      `font sizes are px steps from the type scale (${steps.join(', ')}) (${value})`,
      { line },
    );
  }

  private checkFamily(
    tokens: CssToken[],
    value: string,
    line: number | undefined,
  ) {
    const parts = significant(tokens);
    if (parts.length === 1 && isIdent(parts[0], ...CSS_WIDE)) return;
    const family = firstFamily(tokens);
    if (family === undefined || !this.families.has(family)) {
      const declared = this.definition.typography.fonts
        .map((f) => f.family)
        .join(', ');
      this.add(
        'typography.fonts',
        `the first family must be one of: ${declared} (${value})`,
        { line },
      );
    }
  }

  private checkWeight(
    tokens: CssToken[],
    value: string,
    line: number | undefined,
  ) {
    if (tokens.length === 1 && isIdent(tokens[0], ...CSS_WIDE)) return;
    const [token] = tokens;
    const weight =
      tokens.length !== 1
        ? undefined
        : token.type === 'number'
          ? token.value
          : isIdent(token, 'normal')
            ? 400
            : isIdent(token, 'bold')
              ? 700
              : undefined;
    if (weight === undefined || !this.weights.has(weight)) {
      this.add(
        'typography.fonts',
        `use a weight the fonts ship: ${[...this.weights].sort().join(', ')} (${value})`,
        { line },
      );
    }
  }

  private checkStyleKeyword(
    tokens: CssToken[],
    value: string,
    line: number | undefined,
  ) {
    if (tokens.length === 1 && isIdent(tokens[0], 'normal', ...CSS_WIDE))
      return;
    if (this.italic && tokens.length === 1 && isIdent(tokens[0], 'italic'))
      return;
    this.add(
      'typography.fonts',
      `the fonts ship ${this.italic ? 'normal and italic' : 'normal'} only (${value})`,
      { line },
    );
  }

  /**
   * `font: [style | weight | …]* size [/ line-height] family [, family]*`, or a
   * system font keyword.
   */
  private checkFontShorthand(
    tokens: CssToken[],
    value: string,
    line: number | undefined,
  ) {
    const parts = significant(tokens);
    if (parts.length === 1 && isIdent(parts[0], ...CSS_WIDE)) return;
    if (parts.length === 1 && isIdent(parts[0], ...SYSTEM_FONTS)) {
      this.add('typography.fonts', `system fonts are not allowed (${value})`, {
        line,
      });
      return;
    }

    const [first, ...fallbacks] = splitTopLevel(tokens);
    const head = significant(first);
    const sizeAt = head.findIndex(
      (t) =>
        t.type === 'dimension' ||
        t.type === 'percentage' ||
        t.type === 'function' ||
        isIdent(t, ...FONT_SIZE_KEYWORDS),
    );
    if (sizeAt === -1) {
      this.add(
        'typography.fonts',
        `font needs a size and a family (${value})`,
        { line },
      );
      return;
    }
    for (const token of head.slice(0, sizeAt)) {
      if (
        token.type === 'number' ||
        isIdent(token, 'bold', 'bolder', 'lighter')
      )
        this.checkWeight([token], value, line);
      else if (isIdent(token, 'italic', 'oblique'))
        this.checkStyleKeyword([token], value, line);
    }
    this.checkFontSize([head[sizeAt]], value, line);

    let familyAt = sizeAt + 1;
    if (
      head[familyAt]?.type === 'delim' &&
      (head[familyAt] as { value: string }).value === '/'
    )
      familyAt += 2;
    const familyTokens = head.slice(familyAt);
    const commas: CssToken[] = [{ type: 'delim', value: ',' }];
    this.checkFamily(
      [...familyTokens, ...fallbacks.flatMap((part) => [...commas, ...part])],
      value,
      line,
    );
  }

  private checkTransform(
    tokens: CssToken[],
    value: string,
    line: number | undefined,
  ) {
    const allowed = new Set<string>([
      'none',
      ...this.definition.typography.rules.transforms,
      ...CSS_WIDE,
    ]);
    if (
      tokens.length > 0 &&
      tokens.every((t) => t.type === 'ident' && allowed.has(t.lower))
    )
      return;
    const listed = [
      'none',
      ...this.definition.typography.rules.transforms.filter(
        (t) => t !== 'none',
      ),
    ];
    this.add(
      'typography.rules.transforms',
      `text-transform may be: ${listed.join(', ')} (${value})`,
      { line },
    );
  }

  private checkSpacing(
    property: string,
    tokens: CssToken[],
    value: string,
    line: number | undefined,
  ) {
    const family =
      property === 'margin' || property.startsWith('margin-')
        ? 'margin'
        : property === 'padding' || property.startsWith('padding-')
          ? 'padding'
          : GAP_PROPERTIES.has(property)
            ? 'gap'
            : undefined;
    if (!family || !this.definition.spacing.rules.appliesTo.includes(family))
      return;

    const parts = significant(trimTokens(tokens));
    if (parts.length === 1 && isIdent(parts[0], ...CSS_WIDE)) return;
    const { scale } = this.definition.spacing;
    const valid = parts.every(
      (t) =>
        (t.type === 'number' && t.value === 0) ||
        (t.type === 'dimension' &&
          t.unit === 'px' &&
          (t.value === 0 || scale.includes(t.value))) ||
        (family === 'margin' && isIdent(t, 'auto')),
    );
    if (!valid) {
      this.add(
        'spacing.scale',
        `${family} values are 0${family === 'margin' ? ', auto' : ''} or px steps from the spacing scale (${scale.join(', ')}) (${value})`,
        { line },
      );
    }
  }

  private checkPalette() {
    const background = this.definition.page.background;
    if (!this.declared.has(background)) {
      this.add(
        'page.background',
        `:root must declare --ds-${background}, the page background`,
      );
    }
    for (const [name, line] of this.referenced) {
      if (!this.tokenHex.has(name)) {
        this.add(
          'palette.tokens',
          `var(--ds-${name}) names no palette token; use one of: ${[...this.tokenHex.keys()].join(', ')}`,
          { line },
        );
      } else if (!this.declared.has(name)) {
        this.add(
          'palette.tokens',
          `var(--ds-${name}) is used, but :root does not declare --ds-${name}`,
          { line },
        );
      }
    }
  }
}
