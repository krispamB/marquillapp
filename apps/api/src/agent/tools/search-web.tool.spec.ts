const search = jest.fn();

jest.mock(
  '@tavily/core',
  () => ({
    tavily: jest.fn(() => ({ search })),
  }),
  { virtual: true },
);

import { tavily } from '@tavily/core';
import { createSearchWebTool, runSearchWeb } from './search-web.tool';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('runSearchWeb', () => {
  it('should map Tavily results to the {title,url,content,score} shape with advanced depth', async () => {
    search.mockResolvedValue({
      results: [
        {
          title: 'A',
          url: 'https://a.com',
          content: 'body',
          score: 0.9,
          extra: 'dropped',
        },
      ],
    });

    const output = await runSearchWeb('key', 'staff engineers');

    expect(tavily).toHaveBeenCalledWith({ apiKey: 'key' });
    expect(search).toHaveBeenCalledWith('staff engineers', {
      searchDepth: 'advanced',
      maxResults: 5,
    });
    expect(output).toEqual({
      query: 'staff engineers',
      results: [
        { title: 'A', url: 'https://a.com', content: 'body', score: 0.9 },
      ],
    });
  });

  it('should return an { error } instead of throwing when Tavily fails', async () => {
    search.mockRejectedValue(new Error('rate limited'));

    await expect(runSearchWeb('key', 'q')).resolves.toEqual({
      error: 'rate limited',
    });
  });

  it('should fall back to a generic message when the failure is not an Error', async () => {
    search.mockRejectedValue('boom');

    await expect(runSearchWeb('key', 'q')).resolves.toEqual({
      error: 'Search request failed',
    });
  });
});

describe('createSearchWebTool', () => {
  it('should expose the searchWeb tool with a query parameter schema', () => {
    const tool = createSearchWebTool('key');

    expect(tool.name).toBe('searchWeb');
    expect(tool.parameters.safeParse({ query: 'x' }).success).toBe(true);
    expect(tool.parameters.safeParse({ query: '' }).success).toBe(false);
    expect(tool.parameters.safeParse({}).success).toBe(false);
  });

  it('should run the search when executed', async () => {
    search.mockResolvedValue({ results: [] });
    const tool = createSearchWebTool('key');

    await tool.execute({ query: 'hello' });

    expect(search).toHaveBeenCalledWith('hello', {
      searchDepth: 'advanced',
      maxResults: 5,
    });
  });
});
