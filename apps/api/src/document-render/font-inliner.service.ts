import { Injectable, Logger } from '@nestjs/common';
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import type { DesignSystemDefinition } from '../design-system/design-system-definition';
import { fontStylesheetUrl } from '../document-source/assemble';
import {
  FONT_INLINE_ALWAYS_SUBSETS,
  FONT_INLINE_BUDGET_MS,
  FONT_INLINE_FETCH_TIMEOUT_MS,
  FONT_INLINE_USER_AGENT,
} from './document-render.constants';

type ParentNode = DefaultTreeAdapterMap['parentNode'];

/** One `@font-face` of a Google Fonts css2 response. */
interface FontFaceRule {
  /** Google's label for the subset, from the comment before the rule. */
  subset: string | undefined;
  /** The rule's text, as Google sent it. */
  css: string;
  /** The woff2 file on `fonts.gstatic.com`. */
  fileUrl: string;
  /** Inclusive code point ranges, or `null` when the rule has none (all). */
  ranges: Array<[number, number]> | null;
}

const FACE_PATTERN = /(?:\/\*\s*([\w-]+)\s*\*\/\s*)?(@font-face\s*\{[^}]*\})/g;
const WOFF2_SRC_PATTERN =
  /url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+)\)\s*format\(['"]woff2['"]\)/;
const UNICODE_RANGE_PATTERN = /unicode-range:\s*([^;}]+)/;
const CSS_ESCAPE_PATTERN = /\\([0-9a-fA-F]{1,6})/g;

/** The error, and its cause: undici's `fetch failed` hides the real one. */
const fetchFailureReason = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause as
    | { code?: unknown; message?: unknown }
    | undefined;
  const detail = [cause?.code, cause?.message].find(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );
  return detail ? `${error.message} (${detail})` : error.message;
};

/**
 * Worker-only (spec §4.5 item 2): the Google Fonts a Design System uses, as
 * self-contained CSS for `assemble()`, so the render waits on no font fetch.
 *
 * It fetches the css2 stylesheet as desktop Chrome would, keeps the
 * `@font-face` subsets whose `unicode-range` meets the Candidate Source's
 * text (always `latin` and `latin-ext`), and inlines each kept woff2 file as
 * a `data:font/woff2` URL: the faces Chrome would have downloaded from the
 * `<link>`.
 *
 * Every fetch is cached as a promise for the life of the process, keyed by
 * its URL: the stylesheet by its css2 URL (so systems sharing families share
 * it), each font file by its `fonts.gstatic.com` URL. A rejected fetch is
 * evicted, so the next render tries again. All six launch systems come to
 * about 2.3 MB.
 */
@Injectable()
export class FontInlinerService {
  private readonly logger = new Logger(FontInlinerService.name);
  private readonly stylesheets = new Map<string, Promise<FontFaceRule[]>>();
  private readonly files = new Map<string, Promise<string>>();

  /**
   * The inlined font CSS for `definition` and the text of `candidate`, or
   * `null` when the definition has no Google fonts or any fetch fails. `null`
   * means "assemble with the `<link>`"; it never fails the render.
   */
  async inlineCss(
    definition: DesignSystemDefinition,
    candidate: string,
  ): Promise<string | null> {
    const stylesheetUrl = fontStylesheetUrl(definition);
    if (!stylesheetUrl) return null;
    let timer: NodeJS.Timeout | undefined;
    // A cold inline is a stylesheet then its files; the budget bounds both.
    // Fetches that miss it carry on and fill the cache for the next render.
    const budget = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`not done within ${FONT_INLINE_BUDGET_MS} ms`)),
        FONT_INLINE_BUDGET_MS,
      );
    });
    try {
      return await Promise.race([
        this.inline(stylesheetUrl, candidate),
        budget,
      ]);
    } catch (error: unknown) {
      this.logger.warn(
        `font inlining failed for design system ${definition.id}, rendering with the stylesheet link: ${fetchFailureReason(error)}`,
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async inline(
    stylesheetUrl: string,
    candidate: string,
  ): Promise<string> {
    const faces = await cached(this.stylesheets, stylesheetUrl, () =>
      fetchFaces(stylesheetUrl),
    );
    const codePoints = codePointsOf(candidate);
    const kept = faces.filter((face) => covers(face, codePoints));
    const inlined = await Promise.all(
      kept.map(async (face) => {
        const base64 = await cached(this.files, face.fileUrl, () =>
          fetchBase64(face.fileUrl),
        );
        return face.css.replace(
          `url(${face.fileUrl})`,
          `url(data:font/woff2;base64,${base64})`,
        );
      }),
    );
    return inlined.join('\n');
  }
}

/** The promise for `key`, made once; a rejection is evicted for a retry. */
function cached<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const hit = cache.get(key);
  if (hit) return hit;
  const promise = load();
  cache.set(key, promise);
  promise.catch(() => {
    if (cache.get(key) === promise) cache.delete(key);
  });
  return promise;
}

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url, {
    headers: { 'User-Agent': FONT_INLINE_USER_AGENT },
    signal: AbortSignal.timeout(FONT_INLINE_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response;
}

async function fetchFaces(url: string): Promise<FontFaceRule[]> {
  const faces = parseFaces(await (await fetchOk(url)).text());
  if (faces.length === 0) {
    throw new Error(`no woff2 @font-face in the stylesheet ${url}`);
  }
  return faces;
}

async function fetchBase64(url: string): Promise<string> {
  const bytes = await (await fetchOk(url)).arrayBuffer();
  return Buffer.from(bytes).toString('base64');
}

/** The rules of a css2 response; any rule without a woff2 file throws. */
function parseFaces(stylesheet: string): FontFaceRule[] {
  return [...stylesheet.matchAll(FACE_PATTERN)].map(([, subset, css]) => {
    const fileUrl = WOFF2_SRC_PATTERN.exec(css)?.[1];
    if (!fileUrl) throw new Error('a @font-face without a woff2 source');
    const range = UNICODE_RANGE_PATTERN.exec(css)?.[1];
    return {
      subset,
      css: `${subset ? `/* ${subset} */\n` : ''}${css}`,
      fileUrl,
      ranges: range ? parseUnicodeRange(range) : null,
    };
  });
}

/** `U+0400-045F, U+2116, U+4??` → inclusive ranges. */
function parseUnicodeRange(value: string): Array<[number, number]> {
  return value.split(',').flatMap((part): Array<[number, number]> => {
    const token = part.trim().replace(/^U\+/i, '');
    if (!token) return [];
    if (token.includes('?')) {
      return [
        [
          parseInt(token.replace(/\?/g, '0'), 16),
          parseInt(token.replace(/\?/g, 'F'), 16),
        ],
      ];
    }
    const [low, high = low] = token.split('-');
    return [[parseInt(low, 16), parseInt(high, 16)]];
  });
}

function covers(face: FontFaceRule, codePoints: Set<number>): boolean {
  if (face.subset && FONT_INLINE_ALWAYS_SUBSETS.includes(face.subset)) {
    return true;
  }
  if (!face.ranges) return true;
  for (const point of codePoints) {
    if (face.ranges.some(([low, high]) => point >= low && point <= high)) {
      return true;
    }
  }
  return false;
}

/**
 * Every code point the Candidate Source could paint: its raw characters, its
 * text with character references decoded, and CSS escapes (`content: "\2192"`).
 */
function codePointsOf(candidate: string): Set<number> {
  const texts: string[] = [candidate];
  const walk = (node: ParentNode): void => {
    for (const child of node.childNodes) {
      if (child.nodeName === '#text' && 'value' in child) {
        texts.push(child.value);
      } else if ('childNodes' in child) {
        walk(child);
      }
    }
  };
  walk(parse(candidate));

  const points = new Set<number>();
  for (const text of texts) {
    for (const char of text) points.add(char.codePointAt(0)!);
    for (const [, hex] of text.matchAll(CSS_ESCAPE_PATTERN)) {
      points.add(parseInt(hex, 16));
    }
  }
  return points;
}
