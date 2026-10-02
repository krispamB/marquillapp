import type { DefaultTreeAdapterMap } from 'parse5';
import {
  CssToken,
  lowerAscii,
  splitTopLevel,
  tokenizeCss,
  trimTokens,
} from './css-tokens';

type Element = DefaultTreeAdapterMap['element'];

/**
 * Selectors Level 4, parsed far enough to decide one question: could this
 * selector match a given element of the parsed Candidate Source? The checker
 * asks it of every page element (§4.2: `.page` is reserved for the frame).
 *
 * Answers are conservative: when a pseudo-class cannot be decided statically
 * (`:not()`, `:has()`, `:nth-child()`), it is assumed to match.
 */

export type Combinator = ' ' | '>' | '+' | '~';

export interface AttributeSelector {
  name: string;
  operator?: '=' | '~=' | '|=' | '^=' | '$=' | '*=';
  value?: string;
  insensitive: boolean;
}

export interface PseudoClass {
  name: string;
  /** Present when the argument is a selector list this module can decide. */
  selectors?: ComplexSelector[];
}

export interface CompoundSelector {
  tag?: string;
  ids: string[];
  classes: string[];
  attributes: AttributeSelector[];
  pseudoClasses: PseudoClass[];
  pseudoElement: boolean;
}

export interface ComplexSelector {
  compounds: CompoundSelector[];
  /** `combinators[i]` joins `compounds[i]` to `compounds[i + 1]`. */
  combinators: Combinator[];
}

export class SelectorParseError extends Error {}

/** Pseudo-classes that match when any selector in their argument matches. */
const MATCHES_ANY = new Set([
  'is',
  'where',
  'matches',
  'any',
  '-webkit-any',
  '-moz-any',
]);

const emptyCompound = (): CompoundSelector => ({
  ids: [],
  classes: [],
  attributes: [],
  pseudoClasses: [],
  pseudoElement: false,
});

const nestingCompound = (parent: ComplexSelector[]): CompoundSelector => ({
  ...emptyCompound(),
  pseudoClasses: [{ name: 'is', selectors: parent }],
});

/**
 * Parses a selector list. `parent` is the enclosing rule's selector list when
 * the rule is nested, so `&` and implicit nesting resolve to `:is(parent)`.
 */
export function parseSelectorList(
  text: string,
  parent?: ComplexSelector[],
): ComplexSelector[] {
  return parseTokens(tokenizeCss(text), parent);
}

function parseTokens(
  tokens: CssToken[],
  parent?: ComplexSelector[],
): ComplexSelector[] {
  return splitTopLevel(tokens).map((part) =>
    parseComplex(trimTokens(part), parent),
  );
}

/** Consumes a function's arguments; `i` is just past the function token. */
function consumeArguments(tokens: CssToken[], i: number): [CssToken[], number] {
  let depth = 1;
  const start = i;
  for (; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'function' || token.type === 'open') depth++;
    else if (token.type === 'close' && --depth === 0) {
      return [tokens.slice(start, i), i + 1];
    }
  }
  throw new SelectorParseError('unclosed parenthesis');
}

function parseAttribute(tokens: CssToken[]): AttributeSelector {
  const parts = tokens.filter((token) => token.type !== 'whitespace');
  let i = 0;
  // A namespace prefix (`ns|name`, `*|name`, `|name`) does not change the name.
  if (
    parts[i + 1]?.type === 'delim' &&
    (parts[i + 1] as { value: string }).value === '|' &&
    parts[i + 2]?.type === 'ident'
  ) {
    i += 2;
  } else if (
    parts[i]?.type === 'delim' &&
    (parts[i] as { value: string }).value === '|'
  ) {
    i += 1;
  }
  const name = parts[i++];
  if (name?.type !== 'ident') throw new SelectorParseError('attribute name');
  const attribute: AttributeSelector = { name: name.lower, insensitive: false };
  if (i === parts.length) return attribute;

  const first = parts[i++];
  if (first.type !== 'delim')
    throw new SelectorParseError('attribute operator');
  let operator = first.value;
  if (operator !== '=') {
    const equals = parts[i++];
    if (equals?.type !== 'delim' || equals.value !== '=')
      throw new SelectorParseError('attribute operator');
    operator += '=';
  }
  if (!['=', '~=', '|=', '^=', '$=', '*='].includes(operator))
    throw new SelectorParseError('attribute operator');
  attribute.operator = operator as AttributeSelector['operator'];

  const value = parts[i++];
  if (value?.type !== 'ident' && value?.type !== 'string')
    throw new SelectorParseError('attribute value');
  attribute.value = value.value;

  const flag = parts[i++];
  if (flag) {
    if (flag.type !== 'ident' || (flag.lower !== 'i' && flag.lower !== 's'))
      throw new SelectorParseError('attribute flag');
    attribute.insensitive = flag.lower === 'i';
  }
  if (i < parts.length) throw new SelectorParseError('attribute selector');
  return attribute;
}

function parseComplex(
  tokens: CssToken[],
  parent?: ComplexSelector[],
): ComplexSelector {
  if (tokens.length === 0) throw new SelectorParseError('empty selector');
  const compounds: CompoundSelector[] = [];
  const combinators: Combinator[] = [];
  let compound: CompoundSelector | null = null;
  let combinator: Combinator | null = null;
  let separated = false;
  let nested = false;

  const finish = () => {
    if (compound) compounds.push(compound);
    compound = null;
  };
  const current = (): CompoundSelector => {
    if (compound) return compound;
    if (compounds.length > 0) {
      if (!combinator && !separated)
        throw new SelectorParseError('missing combinator');
      combinators.push(combinator ?? ' ');
    }
    combinator = null;
    separated = false;
    compound = emptyCompound();
    return compound;
  };

  for (let i = 0; i < tokens.length; ) {
    const token = tokens[i];
    const next = tokens[i + 1];

    if (token.type === 'whitespace') {
      finish();
      separated = true;
      i++;
      continue;
    }

    if (
      token.type === 'delim' &&
      (token.value === '>' || token.value === '+' || token.value === '~')
    ) {
      finish();
      if (combinator) throw new SelectorParseError('double combinator');
      if (compounds.length === 0) {
        // A relative selector is only valid nested: `> .a` means `& > .a`.
        if (!parent) throw new SelectorParseError('leading combinator');
        compounds.push(nestingCompound(parent));
        nested = true;
      }
      combinator = token.value;
      i++;
      continue;
    }

    if (
      token.type === 'ident' ||
      (token.type === 'delim' && token.value === '*') ||
      (token.type === 'delim' && token.value === '|')
    ) {
      // A type selector only ever starts a compound.
      if ((compound as CompoundSelector | null) !== null)
        throw new SelectorParseError('type selector out of place');
      const target = current();
      // `ns|tag`, `*|tag` or `|tag`: the namespace never matters here.
      let tag: CssToken | undefined = token;
      let j = i + 1;
      if (token.type === 'delim' && token.value === '|') {
        tag = tokens[j++];
      } else if (next?.type === 'delim' && next.value === '|') {
        tag = tokens[i + 2];
        j = i + 3;
      }
      if (tag?.type === 'ident') target.tag = tag.lower;
      else if (tag?.type === 'delim' && tag.value === '*') target.tag = '*';
      else throw new SelectorParseError('type selector');
      i = j;
      continue;
    }

    if (token.type === 'hash') {
      current().ids.push(token.value);
      i++;
      continue;
    }

    if (token.type === 'delim' && token.value === '.') {
      if (next?.type !== 'ident') throw new SelectorParseError('class name');
      current().classes.push(next.value);
      i += 2;
      continue;
    }

    if (token.type === 'delim' && token.value === '&') {
      current().pseudoClasses.push(
        parent ? { name: 'is', selectors: parent } : { name: 'scope' },
      );
      nested = true;
      i++;
      continue;
    }

    if (token.type === 'open' && token.value === '[') {
      const target = current();
      const end = tokens.findIndex(
        (t, k) => k > i && t.type === 'close' && t.value === ']',
      );
      if (end === -1) throw new SelectorParseError('unclosed attribute');
      target.attributes.push(parseAttribute(tokens.slice(i + 1, end)));
      i = end + 1;
      continue;
    }

    if (token.type === 'delim' && token.value === ':') {
      const target = current();
      let j = i + 1;
      const element =
        tokens[j]?.type === 'delim' &&
        (tokens[j] as { value: string }).value === ':';
      if (element) j++;
      const name = tokens[j];
      let args: CssToken[] | undefined;
      if (name?.type === 'function') {
        [args, j] = consumeArguments(tokens, j + 1);
      } else if (name?.type === 'ident') {
        j++;
      } else throw new SelectorParseError('pseudo-class name');

      const lowerName = name.lower;
      // Legacy single-colon pseudo-elements.
      if (
        element ||
        ['before', 'after', 'first-line', 'first-letter'].includes(lowerName)
      ) {
        target.pseudoElement = true;
      } else {
        const pseudo: PseudoClass = { name: lowerName };
        if (args && (MATCHES_ANY.has(lowerName) || lowerName === 'not')) {
          try {
            pseudo.selectors = parseTokens(args, parent);
            if (parent && containsNesting(args)) nested = true;
          } catch {
            // Undecidable: treated as matching.
          }
        }
        target.pseudoClasses.push(pseudo);
      }
      i = j;
      continue;
    }

    throw new SelectorParseError('unexpected token');
  }

  finish();
  if (combinator) throw new SelectorParseError('trailing combinator');

  if (parent && !nested) {
    // A nested rule without `&` is a descendant of its parent.
    return {
      compounds: [nestingCompound(parent), ...compounds],
      combinators: [' ', ...combinators],
    };
  }
  return { compounds, combinators };
}

const containsNesting = (tokens: CssToken[]) =>
  tokens.some((token) => token.type === 'delim' && token.value === '&');

const attributeOf = (element: Element, name: string): string | undefined =>
  element.attrs.find((attr) => attr.name === name)?.value;

const parentElement = (element: Element): Element | null => {
  const parent = element.parentNode as Element | null;
  return parent && 'tagName' in parent ? parent : null;
};

const previousSiblings = (element: Element): Element[] => {
  const parent = element.parentNode;
  if (!parent) return [];
  const siblings = parent.childNodes.filter(
    (node): node is Element => 'tagName' in node,
  );
  return siblings.slice(0, siblings.indexOf(element)).reverse();
};

function attributeMatches(
  selector: AttributeSelector,
  element: Element,
): boolean {
  const raw = attributeOf(element, selector.name);
  if (raw === undefined) return false;
  if (!selector.operator) return true;
  const fold = (s: string) => (selector.insensitive ? lowerAscii(s) : s);
  const actual = fold(raw);
  const value = fold(selector.value ?? '');
  switch (selector.operator) {
    case '=':
      return actual === value;
    case '~=':
      return value !== '' && actual.split(/\s+/).includes(value);
    case '|=':
      return actual === value || actual.startsWith(`${value}-`);
    case '^=':
      return value !== '' && actual.startsWith(value);
    case '$=':
      return value !== '' && actual.endsWith(value);
    case '*=':
      return value !== '' && actual.includes(value);
  }
}

function compoundMayMatch(
  compound: CompoundSelector,
  element: Element,
): boolean {
  // A pseudo-element selects generated content, never the element itself.
  if (compound.pseudoElement) return false;
  if (compound.tag && compound.tag !== '*' && compound.tag !== element.tagName)
    return false;
  if (compound.ids.some((id) => attributeOf(element, 'id') !== id))
    return false;
  const classes = (attributeOf(element, 'class') ?? '').split(/\s+/);
  if (compound.classes.some((name) => !classes.includes(name))) return false;
  if (compound.attributes.some((a) => !attributeMatches(a, element)))
    return false;
  return compound.pseudoClasses.every((pseudo) => {
    if (MATCHES_ANY.has(pseudo.name)) {
      return (
        !pseudo.selectors ||
        pseudo.selectors.some((s) => selectorMayMatch(s, element))
      );
    }
    if (pseudo.name === 'root' || pseudo.name === 'scope') {
      return element.parentNode?.nodeName === '#document';
    }
    return true;
  });
}

/** Could `selector` match `element`? `true` whenever it cannot be ruled out. */
export function selectorMayMatch(
  selector: ComplexSelector,
  element: Element,
): boolean {
  const matchAt = (index: number, candidate: Element): boolean => {
    if (!compoundMayMatch(selector.compounds[index], candidate)) return false;
    if (index === 0) return true;
    switch (selector.combinators[index - 1]) {
      case '>': {
        const parent = parentElement(candidate);
        return parent !== null && matchAt(index - 1, parent);
      }
      case ' ': {
        for (let p = parentElement(candidate); p; p = parentElement(p)) {
          if (matchAt(index - 1, p)) return true;
        }
        return false;
      }
      case '+': {
        const previous = previousSiblings(candidate)[0];
        return previous !== undefined && matchAt(index - 1, previous);
      }
      case '~':
        return previousSiblings(candidate).some((s) => matchAt(index - 1, s));
    }
  };
  return matchAt(selector.compounds.length - 1, element);
}
