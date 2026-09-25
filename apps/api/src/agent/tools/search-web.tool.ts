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

/**
 * Plain Tavily search, extracted from the former Mark agent's `web_search` tool.
 *
 * **Never throws.** A Tavily fault comes back as `{ error }` so the agent loop
 * absorbs it and lets the model adapt its next query, rather than failing the
 * whole run on a transient outage.
 */
export const runSearchWeb = async (
  apiKey: string,
  query: string,
): Promise<SearchWebOutput> => {
  const client = tavily({ apiKey });
  try {
    const response: TavilySearchResponse = await client.search(query, {
      searchDepth: 'advanced',
      maxResults: 5,
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
 * Wraps the Tavily search as the research agent's single `Tool`. Built once from
 * the configured API key and handed to `AgentRunner.run`.
 */
export const createSearchWebTool = (
  apiKey: string,
): Tool<SearchWebInput, SearchWebOutput> => ({
  name: 'searchWeb',
  description: SEARCH_WEB_DESCRIPTION,
  parameters: searchWebParameters,
  execute: ({ query }) => runSearchWeb(apiKey, query),
});
