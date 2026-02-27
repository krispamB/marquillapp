import { Logger } from '@nestjs/common';

jest.mock('../llm/llm.service', () => ({
  LLMService: class LLMService {},
}));
jest.mock('../actors/actors.service', () => ({
  ActorsService: class ActorsService {},
}));
jest.mock('../llm/parsers/responseParser.service', () => ({
  ResponseParserService: class ResponseParserService {},
}));
jest.mock('@nestjs/config', () => ({
  ConfigService: class ConfigService {},
}));
jest.mock('@nestjs/axios', () => ({
  HttpService: class HttpService {},
}));
jest.mock('@supadata/js', () => ({
  Supadata: class Supadata {},
}));
jest.mock(
  'src/database/schemas',
  () => ({
    PostDraft: { name: 'PostDraft' },
  }),
  { virtual: true },
);

import { AgentService } from './agent.service';

describe('AgentService.searchYoutube', () => {
  const createService = () => {
    const service = Object.create(AgentService.prototype) as AgentService;
    const list = jest.fn();

    (service as any).youtube = {
      search: {
        list,
      },
    };

    (service as any).logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as Logger;

    return { service, list };
  };

  const makeItem = (overrides: any = {}) => ({
    id: { videoId: 'video-1' },
    snippet: {
      title: 'Video title',
      thumbnails: { high: { url: 'https://example.com/thumb.jpg' } },
      channelTitle: 'Test channel',
      publishedAt: '2025-01-01T00:00:00Z',
    },
    ...overrides,
  });

  it('returns initial results when first search is non-empty', async () => {
    const { service, list } = createService();
    list.mockResolvedValueOnce({ data: { items: [makeItem()] } });

    const result = await service.searchYoutube('nestjs tutorial', 2);

    expect(result).toEqual([
      {
        videoId: 'video-1',
        title: 'Video title',
        thumbnail: 'https://example.com/thumb.jpg',
        channelTitle: 'Test channel',
        publishedAt: '2025-01-01T00:00:00Z',
      },
    ]);
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ q: 'nestjs tutorial', maxResults: 2 }),
    );
  });

  it('retries with first | segment when first search is empty', async () => {
    const { service, list } = createService();
    list
      .mockResolvedValueOnce({ data: { items: [] } })
      .mockResolvedValueOnce({ data: { items: [makeItem()] } });

    const result = await service.searchYoutube('nestjs tutorial | overview', 3);

    expect(result).toHaveLength(1);
    expect(result[0].videoId).toBe('video-1');
    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ q: 'nestjs tutorial | overview', maxResults: 3 }),
    );
    expect(list).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ q: 'nestjs tutorial', maxResults: 3 }),
    );
  });

  it('returns empty array when first search is empty and fallback search is empty', async () => {
    const { service, list } = createService();
    list
      .mockResolvedValueOnce({ data: { items: [] } })
      .mockResolvedValueOnce({ data: { items: [] } });

    const result = await service.searchYoutube('nestjs tutorial | overview', 3);

    expect(result).toEqual([]);
    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ q: 'nestjs tutorial', maxResults: 3 }),
    );
  });

  it('returns empty array with no retry when query has no | and first search is empty', async () => {
    const { service, list } = createService();
    list.mockResolvedValueOnce({ data: { items: [] } });

    const result = await service.searchYoutube('nestjs tutorial', 2);

    expect(result).toEqual([]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('returns empty array with no retry when query starts with | and first search is empty', async () => {
    const { service, list } = createService();
    list.mockResolvedValueOnce({ data: { items: [] } });

    const result = await service.searchYoutube(' | overview', 2);

    expect(result).toEqual([]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('throws Failed to search YouTube videos when API call throws', async () => {
    const { service, list } = createService();
    list.mockRejectedValueOnce(new Error('api failed'));

    await expect(service.searchYoutube('nestjs tutorial')).rejects.toThrow(
      'Failed to search YouTube videos',
    );
  });
});
