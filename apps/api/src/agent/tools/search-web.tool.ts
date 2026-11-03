import { tavily, TavilySearchResponse } from '@tavily/core';
import { z } from 'zod';
import type { Tool } from '../agent-runner.interface';

export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

export type SearchWebOutput =
  | { query: string; results: WebSearchResult[] }
  | { error: string };

export const searchWebParameters = z.object({
  query: z.string().min(1).describe('The search query to run against the web.'),
});

export type SearchWebInput = z.infer<typeof searchWebParameters>;

const SEARCH_WEB_DESCRIPTION =
  'Search the web for current, factual information on a topic. ' +
  'Returns the most relevant results with their title, url, and a content ' +
  'snippet. Call it repeatedly with refined queries to gather what you need.';

export type SearchDepth = 'basic' | 'advanced';

export interface SearchWebOptions {
  /** Per-request timeout in seconds (the SDK default is 60). */
  timeoutS: number;
  searchDepth: SearchDepth;
}

export const DEFAULT_TAVILY_TIMEOUT_S = 10;
export const DEFAULT_TAVILY_SEARCH_DEPTH: SearchDepth = 'advanced';

/**
 * Parses the raw `TAVILY_TIMEOUT_S` / `TAVILY_SEARCH_DEPTH` config values.
 * Anything unset or invalid falls back to the default rather than failing boot.
 */
export const resolveSearchWebOptions = (
  rawTimeoutS?: string | number | null,
  rawDepth?: string | null,
): SearchWebOptions => {
  const timeout = Number(rawTimeoutS);
  const depth =
    typeof rawDepth === 'string' ? rawDepth.trim().toLowerCase() : '';
  const timeoutSet =
    rawTimeoutS !== undefined && rawTimeoutS !== null && rawTimeoutS !== '';
  return {
    timeoutS:
      timeoutSet && Number.isFinite(timeout) && timeout > 0
        ? timeout
        : DEFAULT_TAVILY_TIMEOUT_S,
    searchDepth:
      depth === 'basic' || depth === 'advanced'
        ? depth
        : DEFAULT_TAVILY_SEARCH_DEPTH,
  };
};

type TavilyClient = ReturnType<typeof tavily>;

/**
 * Plain Tavily search, extracted from the former Mark agent's `web_search` tool.
 *
 * **Never throws.** A Tavily fault (including a timeout) comes back as
 * `{ error }` so the agent loop absorbs it and lets the model adapt its next
 * query, rather than failing the whole run on a transient outage.
 */
export const runSearchWeb = async (
  client: TavilyClient,
  query: string,
  options: SearchWebOptions,
): Promise<SearchWebOutput> => {
  try {
    const response: TavilySearchResponse = await client.search(query, {
      searchDepth: options.searchDepth,
      maxResults: 5,
      timeout: options.timeoutS,
    });
    return {
      query,
      results: response.results.map((r) => ({
        title: r.title,
        url: r.url,
        content: r.content,
        score: r.score,
      })),
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Search request failed';
    return { error: message };
  }
};

/**
 * Wraps the Tavily search as the research agent's single `Tool`. Built once per
 * process from the configured API key: one Tavily client is shared by every call.
 */
export const createSearchWebTool = (
  apiKey: string,
  options: SearchWebOptions = resolveSearchWebOptions(),
): Tool<SearchWebInput, SearchWebOutput> => {
  const client = tavily({ apiKey });
  return {
    name: 'searchWeb',
    description: SEARCH_WEB_DESCRIPTION,
    parameters: searchWebParameters,
    execute: ({ query }) => runSearchWeb(client, query, options),
  };
};
