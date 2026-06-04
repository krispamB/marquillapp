import { tool } from 'ai';
import { tavily, TavilySearchResponse } from '@tavily/core';
import { z } from 'zod';

export const createWebSearchTool = (apiKey: string) => {
  const client = tavily({ apiKey });

  return tool({
    description:
      'Search the web for up-to-date information needed to generate the artifact. ' +
      'Always call this before generating any artifact. Do not generate until you have sufficient context.',
    inputSchema: z.object({
      query: z
        .string()
        .describe('The search query to look up eg. "latest AI trends"'),
    }),
    execute: async ({ query }) => {
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
    },
  });
};
