const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

/**
 * The decoded value of a top-level string field in a JSON object that may
 * still be arriving: the whole value once its string has closed, what has
 * arrived so far while it is open, or `undefined` when the field has not
 * started or is not a string. An escape cut off by the end of the buffer, and
 * a high surrogate whose low half has not arrived, are held back until the
 * next call.
 */
export function extractStringField(
  buffer: string,
  field: string,
): string | undefined {
  const key = JSON.stringify(field);
  let depth = 0;
  for (let i = 0; i < buffer.length; i++) {
    const char = buffer[i];
    if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') depth--;
    if (char !== '"') continue;

    const end = stringEnd(buffer, i);
    if (end === undefined) return undefined;
    if (depth === 1 && buffer.slice(i, end) === key) {
      const colon = skipSpace(buffer, end);
      if (buffer[colon] === ':') {
        const value = skipSpace(buffer, colon + 1);
        if (value >= buffer.length || buffer[value] !== '"') return undefined;
        return decodeOpenString(buffer, value + 1);
      }
    }
    i = end - 1;
  }
  return undefined;
}

/** The index just past the string opening at `start`, if it has closed. */
function stringEnd(buffer: string, start: number): number | undefined {
  for (let i = start + 1; i < buffer.length; i++) {
    if (buffer[i] === '\\') i++;
    else if (buffer[i] === '"') return i + 1;
  }
  return undefined;
}

function skipSpace(buffer: string, from: number): number {
  let i = from;
  while (i < buffer.length && /\s/.test(buffer[i])) i++;
  return i;
}

function decodeOpenString(buffer: string, from: number): string {
  let out = '';
  for (let i = from; i < buffer.length; i++) {
    const char = buffer[i];
    if (char === '"') return out;
    if (char !== '\\') {
      out += char;
      continue;
    }
    const escape = buffer[i + 1];
    if (escape === undefined) return out;
    if (escape !== 'u') {
      const decoded = SIMPLE_ESCAPES[escape];
      if (decoded === undefined) return out;
      out += decoded;
      i++;
      continue;
    }
    const unit = readUnit(buffer, i);
    if (unit === undefined) return out;
    if (unit >= 0xd800 && unit <= 0xdbff && readUnit(buffer, i + 6) === undefined) {
      return out;
    }
    out += String.fromCharCode(unit);
    i += 5;
  }
  return out;
}

/** The code unit of the `\uXXXX` escape at `at`, if all of it has arrived. */
function readUnit(buffer: string, at: number): number | undefined {
  const hex = buffer.slice(at + 2, at + 6);
  return buffer.slice(at, at + 2) === '\\u' && /^[0-9a-fA-F]{4}$/.test(hex)
    ? parseInt(hex, 16)
    : undefined;
}
