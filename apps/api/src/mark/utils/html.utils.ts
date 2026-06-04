import { parse, parseFragment } from 'parse5';

interface ParseErrorDetail {
  code: string;
  line: number;
  col: number;
}

export interface HtmlValidationResult {
  valid: boolean;
  errors: ParseErrorDetail[];
}

/**
 * Validates HTML and returns a result object (no throwing).
 * @param html - Raw HTML string
 * @param fragment - Set true for partial HTML (no <html>/<body> wrapping)
 */
export function validateHtml(
  html: string,
  fragment = false,
): HtmlValidationResult {
  const errors: ParseErrorDetail[] = [];

  const onParseError = (err: {
    code: string;
    startLine: number;
    startCol: number;
  }) => {
    errors.push({ code: err.code, line: err.startLine, col: err.startCol });
  };

  if (fragment) {
    parseFragment(html, { onParseError });
  } else {
    parse(html, { onParseError });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Auto-corrects HTML and returns the cleaned string.
 * parse5 corrects like a browser — no errors thrown.
 * @param html - Raw HTML string
 * @param fragment - Set true for partial HTML
 */
export function correctHtml(html: string, fragment = false): string {
  const { serialize } = require('parse5'); // or use top-level import

  if (fragment) {
    const tree = parseFragment(html);
    return serialize(tree);
  }

  const tree = parse(html);
  return serialize(tree);
}

/**
 * Strict mode — throws if HTML has parse errors, otherwise returns corrected HTML.
 */
export function strictParseHtml(html: string, fragment = false): string {
  const { valid, errors } = validateHtml(html, fragment);

  if (!valid) {
    const summary = errors
      .map((e) => `[${e.line}:${e.col}] ${e.code}`)
      .join('\n');
    throw new Error(`Invalid HTML:\n${summary}`);
  }

  return correctHtml(html, fragment);
}
