import { z } from 'zod';
import type {
  ResearchMode,
  ResearchResult,
  ResearchSource,
} from './agent-runner.interface';
import type { WebSearchResult } from './tools';

/** Most searches one snippet research runs. */
export const MAX_SNIPPET_QUERIES = 4;
/** Tavily rejects a longer query. */
const MAX_QUERY_CHARS = 400;

export const DEFAULT_RESEARCH_MAX_SNIPPETS = 10;
export const DEFAULT_RESEARCH_SNIPPET_CHARS = 600;

/** What the query call is asked for, as structured output. */
export const snippetQueriesSchema = z.object({
  queries: z.array(z.string().min(1)).min(1).max(MAX_SNIPPET_QUERIES),
});

/**
 * What its answer is read with: looser than what was asked for, so a fifth
 * query or a blank one is dropped by `cleanSnippetQueries` rather than
 * failing the whole answer.
 */
export const snippetQueriesAnswerSchema = z.object({
  queries: z.array(z.string()),
});

/**
 * The queries to search: trimmed, blank and case-insensitive repeats
 * dropped, each cut to Tavily's length limit, at most four. When none are
 * left, the brief itself is the one query.
 */
export const cleanSnippetQueries = (
  queries: readonly string[],
  brief: string,
): string[] => {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of queries) {
    const query = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_CHARS);
    const key = query.toLowerCase();
    if (query === '' || seen.has(key)) continue;
    seen.add(key);
    kept.push(query);
    if (kept.length === MAX_SNIPPET_QUERIES) break;
  }
  if (kept.length > 0) return kept;
  return [brief.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_CHARS)];
};

/**
 * Reads `RESEARCH_MODE`. Unset or blank is `agent`; anything but `agent` or
 * `snippets` throws, so a typo fails worker boot instead of silently
 * falling back.
 */
export const readResearchMode = (
  raw: string | number | null | undefined,
): ResearchMode => {
  const value =
    raw === undefined || raw === null ? '' : String(raw).trim().toLowerCase();
  if (value === '' || value === 'agent') return 'agent';
  if (value === 'snippets') return 'snippets';
  throw new Error(
    `RESEARCH_MODE must be agent or snippets, or unset; got "${String(raw)}"`,
  );
};

/** One successful search: its query and Tavily's results, best first. */
export interface SnippetSearch {
  query: string;
  results: WebSearchResult[];
}

export interface SnippetLimits {
  /** Most snippets kept across every search (`RESEARCH_MAX_SNIPPETS`). */
  maxSnippets: number;
  /** Most characters kept of each excerpt (`RESEARCH_SNIPPET_CHARS`). */
  snippetChars: number;
}

// Query parameters that only track the click and never change the page.
const TRACKING_PARAM = /^(utm_\w+|fbclid|gclid|mc_cid|mc_eid|ref)$/i;

/**
 * A URL in the form two results are compared by: lowercase host without
 * `www.`, no default port, no fragment, no tracking parameters, and no
 * trailing slash on a path. A value that does not parse is only trimmed.
 */
export const normaliseSnippetUrl = (raw: string): string => {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }
  url.hash = '';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  }
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }
  return url.toString();
};

const excerpt = (content: string, maxChars: number): string => {
  const collapsed = content.replace(/\s+/g, ' ').trim();
  return collapsed.length <= maxChars
    ? collapsed
    : `${collapsed.slice(0, maxChars - 1).trimEnd()}…`;
};

/**
 * Round-robin over the searches, so each query's best result comes before
 * any query's second: `q1[0], q2[0], q3[0], q1[1], ...`.
 */
const interleave = (searches: SnippetSearch[]): WebSearchResult[] => {
  const longest = Math.max(0, ...searches.map((s) => s.results.length));
  const order: WebSearchResult[] = [];
  for (let rank = 0; rank < longest; rank++) {
    for (const search of searches) {
      const result = search.results[rank];
      if (result) order.push(result);
    }
  }
  return order;
};

/**
 * Snippet research (plan M7.2): the raw excerpts of a few parallel searches,
 * interleaved by query, deduped by normalised URL, and capped, as numbered
 * `[n] Title (url)` blocks the generation prompt cites. No model reads them
 * first, so `findings` is web text, not a synthesis.
 */
export const buildSnippetResearch = (
  searches: SnippetSearch[],
  { maxSnippets, snippetChars }: SnippetLimits,
): ResearchResult => {
  const seen = new Set<string>();
  const kept: Array<ResearchSource & { text: string }> = [];

  for (const result of interleave(searches)) {
    if (kept.length >= maxSnippets) break;
    const url = normaliseSnippetUrl(result.url);
    if (seen.has(url)) continue;
    const text = excerpt(result.content ?? '', snippetChars);
    if (text === '') continue;
    seen.add(url);
    kept.push({ title: result.title?.trim() || url, url, text });
  }

  return {
    findings: kept
      .map(({ title, url, text }, i) => `[${i + 1}] ${title} (${url})\n${text}`)
      .join('\n\n'),
    sources: kept.map(({ title, url }) => ({ title, url })),
    mode: 'snippets',
  };
};
