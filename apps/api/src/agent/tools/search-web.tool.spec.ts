const search = jest.fn();

jest.mock(
  '@tavily/core',
  () => ({
    tavily: jest.fn(() => ({ search })),
  }),
  { virtual: true },
);

import { tavily } from '@tavily/core';
import {
  createSearchWebTool,
  resolveSearchWebOptions,
  runSearchWeb,
} from './search-web.tool';

beforeEach(() => {
  jest.clearAllMocks();
});

const OPTIONS = { timeoutS: 10, searchDepth: 'advanced' as const };

describe('resolveSearchWebOptions', () => {
  it('should default to a 10 s timeout and advanced depth when unset', () => {
    expect(resolveSearchWebOptions()).toEqual(OPTIONS);
  });

  it('should accept a numeric-string timeout and basic depth', () => {
    expect(resolveSearchWebOptions('4', 'basic')).toEqual({
      timeoutS: 4,
      searchDepth: 'basic',
    });
  });

  it('should fall back to the defaults when values are invalid', () => {
    expect(resolveSearchWebOptions('abc', 'deep')).toEqual(OPTIONS);
    expect(resolveSearchWebOptions(0, '')).toEqual(OPTIONS);
    expect(resolveSearchWebOptions(-3, 'fast')).toEqual(OPTIONS);
  });
});

describe('runSearchWeb', () => {
  const client = { search } as unknown as Parameters<typeof runSearchWeb>[0];

  it('should map Tavily results to the {title,url,content,score} shape and pass depth and timeout', async () => {
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

    const output = await runSearchWeb(client, 'staff engineers', OPTIONS);

    expect(search).toHaveBeenCalledWith('staff engineers', {
      searchDepth: 'advanced',
      maxResults: 5,
      timeout: 10,
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

    await expect(runSearchWeb(client, 'q', OPTIONS)).resolves.toEqual({
      error: 'rate limited',
    });
  });

  it('should fall back to a generic message when the failure is not an Error', async () => {
    search.mockRejectedValue('boom');

    await expect(runSearchWeb(client, 'q', OPTIONS)).resolves.toEqual({
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

  it('should build one client and reuse it across calls, with default depth and timeout', async () => {
    search.mockResolvedValue({ results: [] });
    const tool = createSearchWebTool('key');

    await tool.execute({ query: 'hello' });
    await tool.execute({ query: 'again' });

    expect(tavily).toHaveBeenCalledTimes(1);
    expect(tavily).toHaveBeenCalledWith({ apiKey: 'key' });
    expect(search).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenCalledWith('hello', {
      searchDepth: 'advanced',
      maxResults: 5,
      timeout: 10,
    });
  });

  it('should pass the configured basic depth and timeout', async () => {
    search.mockResolvedValue({ results: [] });
    const tool = createSearchWebTool(
      'key',
      resolveSearchWebOptions('3', 'basic'),
    );

    await tool.execute({ query: 'hello' });

    expect(search).toHaveBeenCalledWith('hello', {
      searchDepth: 'basic',
      maxResults: 5,
      timeout: 3,
    });
  });
});
