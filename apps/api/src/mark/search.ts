import { tavily, TavilySearchResponse } from '@tavily/core';

export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

// Plain web-search helper extracted from the former Mark agent's web_search
// tool. Returns up-to-date results for a query, or an { error } shape on
// failure. No live caller today — kept for a future agent rebuild.
export const searchWeb = async (
  apiKey: string,
  query: string,
): Promise<{ query: string; results: WebSearchResult[] } | { error: string }> => {
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
  } catch (err: any) {
    return { error: err?.message ?? 'Search request failed' };
  }
};
