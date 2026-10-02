/**
 * A CSS Syntax Level 3 tokenizer for declaration values, at-rule preludes and
 * selectors, small enough to read. postcss splits a stylesheet into rules and
 * declarations but leaves values as text; the checker needs them as tokens so
 * that escapes (`u\72l(`), comments and case can never disguise a token.
 *
 * Names are escape-decoded; `lower` is the ASCII-lowercased name used for every
 * comparison, because CSS keywords and function names are case-insensitive.
 */
export type CssToken =
  | { type: 'ident'; value: string; lower: string }
  | { type: 'function'; value: string; lower: string }
  | { type: 'at-keyword'; value: string; lower: string }
  | { type: 'hash'; value: string; lower: string }
  | { type: 'url'; value: string }
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'percentage'; value: number }
  | { type: 'dimension'; value: number; unit: string }
  | { type: 'whitespace' }
  | { type: 'open'; value: '(' | '[' | '{' }
  | { type: 'close'; value: ')' | ']' | '}' }
  | { type: 'delim'; value: string };

export const lowerAscii = (value: string) =>
  value.replace(/[A-Z]/g, (c) => c.toLowerCase());

const isDigit = (c: string | undefined) =>
  c !== undefined && c >= '0' && c <= '9';
const isHex = (c: string | undefined) =>
  isDigit(c) ||
  (c !== undefined && ((c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')));
const isWhitespace = (c: string | undefined) =>
  c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
const isNameStart = (c: string | undefined) =>
  c !== undefined &&
  ((c >= 'a' && c <= 'z') ||
    (c >= 'A' && c <= 'Z') ||
    c === '_' ||
    c.charCodeAt(0) >= 0x80);
const isName = (c: string | undefined) =>
  isNameStart(c) || isDigit(c) || c === '-';
const isNewline = (c: string | undefined) =>
  c === '\n' || c === '\r' || c === '\f';

export function tokenizeCss(input: string): CssToken[] {
  const tokens: CssToken[] = [];
  let i = 0;

  const validEscape = (at: number) =>
    input[at] === '\\' && at + 1 < input.length && !isNewline(input[at + 1]);

  const startsIdent = (at: number) => {
    const c = input[at];
    if (c === '-') {
      const next = input[at + 1];
      return isNameStart(next) || next === '-' || validEscape(at + 1);
    }
    return isNameStart(c) || validEscape(at);
  };

  const startsNumber = (at: number) => {
    const c = input[at];
    if (c === '+' || c === '-') {
      return (
        isDigit(input[at + 1]) ||
        (input[at + 1] === '.' && isDigit(input[at + 2]))
      );
    }
    if (c === '.') return isDigit(input[at + 1]);
    return isDigit(c);
  };

  /** Consumes an escape whose backslash is at `i`. */
  const consumeEscape = (): string => {
    i++; // the backslash
    if (isHex(input[i])) {
      let hex = '';
      while (hex.length < 6 && isHex(input[i])) hex += input[i++];
      if (isWhitespace(input[i])) i++;
      const code = parseInt(hex, 16);
      return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)
        ? '�'
        : String.fromCodePoint(code);
    }
    if (i >= input.length) return '�';
    return input[i++];
  };

  const consumeName = (): string => {
    let name = '';
    while (i < input.length) {
      if (isName(input[i])) name += input[i++];
      else if (validEscape(i)) name += consumeEscape();
      else break;
    }
    return name;
  };

  const consumeNumber = (): number => {
    const start = i;
    if (input[i] === '+' || input[i] === '-') i++;
    while (isDigit(input[i])) i++;
    if (input[i] === '.' && isDigit(input[i + 1])) {
      i++;
      while (isDigit(input[i])) i++;
    }
    if (
      (input[i] === 'e' || input[i] === 'E') &&
      (isDigit(input[i + 1]) ||
        ((input[i + 1] === '+' || input[i + 1] === '-') &&
          isDigit(input[i + 2])))
    ) {
      i += 2;
      while (isDigit(input[i])) i++;
    }
    return Number(input.slice(start, i));
  };

  const consumeString = (quote: string): string => {
    i++;
    let value = '';
    while (i < input.length && input[i] !== quote) {
      if (input[i] === '\\') {
        if (isNewline(input[i + 1])) i += 2;
        else value += consumeEscape();
      } else if (isNewline(input[i])) {
        break; // a bad string; postcss has already refused it
      } else value += input[i++];
    }
    i++;
    return value;
  };

  /** An unquoted `url(`; `i` is just past the `(`. */
  const consumeUrl = (): string => {
    let value = '';
    while (isWhitespace(input[i])) i++;
    while (i < input.length && input[i] !== ')') {
      if (validEscape(i)) value += consumeEscape();
      else value += input[i++];
    }
    i++;
    return value.trim();
  };

  const consumeIdentLike = () => {
    const name = consumeName();
    if (input[i] !== '(') {
      tokens.push({ type: 'ident', value: name, lower: lowerAscii(name) });
      return;
    }
    i++;
    if (lowerAscii(name) === 'url') {
      let j = i;
      while (isWhitespace(input[j])) j++;
      if (input[j] !== '"' && input[j] !== "'") {
        tokens.push({ type: 'url', value: consumeUrl() });
        return;
      }
    }
    tokens.push({ type: 'function', value: name, lower: lowerAscii(name) });
  };

  while (i < input.length) {
    const c = input[i];

    if (c === '/' && input[i + 1] === '*') {
      const end = input.indexOf('*/', i + 2);
      i = end === -1 ? input.length : end + 2;
      continue;
    }
    if (isWhitespace(c)) {
      while (isWhitespace(input[i])) i++;
      if (tokens.at(-1)?.type !== 'whitespace')
        tokens.push({ type: 'whitespace' });
      continue;
    }
    if (c === '"' || c === "'") {
      tokens.push({ type: 'string', value: consumeString(c) });
      continue;
    }
    if (c === '#' && (isName(input[i + 1]) || validEscape(i + 1))) {
      i++;
      const name = consumeName();
      tokens.push({ type: 'hash', value: name, lower: lowerAscii(name) });
      continue;
    }
    if (startsNumber(i)) {
      const value = consumeNumber();
      if (startsIdent(i)) {
        tokens.push({
          type: 'dimension',
          value,
          unit: lowerAscii(consumeName()),
        });
      } else if (input[i] === '%') {
        i++;
        tokens.push({ type: 'percentage', value });
      } else tokens.push({ type: 'number', value });
      continue;
    }
    if (startsIdent(i)) {
      consumeIdentLike();
      continue;
    }
    if (c === '@' && startsIdent(i + 1)) {
      i++;
      const name = consumeName();
      tokens.push({ type: 'at-keyword', value: name, lower: lowerAscii(name) });
      continue;
    }
    if (c === '(' || c === '[' || c === '{') {
      tokens.push({ type: 'open', value: c });
      i++;
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      tokens.push({ type: 'close', value: c });
      i++;
      continue;
    }
    tokens.push({ type: 'delim', value: c });
    i++;
  }

  return tokens;
}

/** Decodes the escapes in one name, e.g. a postcss property or at-rule name. */
export function decodeCssName(name: string): string {
  const tokens = tokenizeCss(name);
  return tokens.length === 1 && tokens[0].type === 'ident'
    ? tokens[0].value
    : name;
}

/** Splits tokens on top-level commas. */
export function splitTopLevel(tokens: CssToken[], on = ','): CssToken[][] {
  const parts: CssToken[][] = [[]];
  let depth = 0;
  for (const token of tokens) {
    if (token.type === 'open' || token.type === 'function') depth++;
    else if (token.type === 'close') depth--;
    if (depth === 0 && token.type === 'delim' && token.value === on) {
      parts.push([]);
      continue;
    }
    parts.at(-1)!.push(token);
  }
  return parts;
}

/** Drops leading and trailing whitespace tokens. */
export function trimTokens(tokens: CssToken[]): CssToken[] {
  let start = 0;
  let end = tokens.length;
  while (start < end && tokens[start].type === 'whitespace') start++;
  while (end > start && tokens[end - 1].type === 'whitespace') end--;
  return tokens.slice(start, end);
}
