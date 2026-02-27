const fetchTranscriptMock = jest.fn();

jest.mock('@danielxceron/youtube-transcript', () => ({
  YoutubeTranscript: {
    fetchTranscript: fetchTranscriptMock,
  },
}));

import {
  InvalidYouTubeVideoInputError,
  YouTubeTranscriptFetchError,
  YoutubeTranscriptService,
} from './youtube-transcript.service';

describe('YoutubeTranscriptService', () => {
  let service: YoutubeTranscriptService;

  beforeEach(() => {
    service = new YoutubeTranscriptService();
    fetchTranscriptMock.mockReset();
  });

  it('accepts a raw video id and returns normalized transcript text', async () => {
    fetchTranscriptMock.mockResolvedValue([
      { text: 'Hello\n' },
      { text: '   world   ' },
    ]);

    const result = await service.getTranscript('uWfgMi2_Slc');

    expect(fetchTranscriptMock).toHaveBeenCalledWith('uWfgMi2_Slc');
    expect(result).toBe('Hello world');
  });

  it('accepts youtube.com watch URL', async () => {
    fetchTranscriptMock.mockResolvedValue([{ text: 'Transcript text' }]);

    const result = await service.getTranscript(
      'https://www.youtube.com/watch?v=uWfgMi2_Slc',
    );

    expect(fetchTranscriptMock).toHaveBeenCalledWith('uWfgMi2_Slc');
    expect(result).toBe('Transcript text');
  });

  it('accepts youtu.be URL', async () => {
    fetchTranscriptMock.mockResolvedValue([{ text: 'Short url transcript' }]);

    const result = await service.getTranscript('https://youtu.be/uWfgMi2_Slc');

    expect(fetchTranscriptMock).toHaveBeenCalledWith('uWfgMi2_Slc');
    expect(result).toBe('Short url transcript');
  });

  it('accepts shorts and embed URLs', async () => {
    fetchTranscriptMock.mockResolvedValue([{ text: 'ok' }]);

    await service.getTranscript('https://www.youtube.com/shorts/uWfgMi2_Slc');
    await service.getTranscript('https://www.youtube.com/embed/uWfgMi2_Slc');

    expect(fetchTranscriptMock).toHaveBeenNthCalledWith(1, 'uWfgMi2_Slc');
    expect(fetchTranscriptMock).toHaveBeenNthCalledWith(2, 'uWfgMi2_Slc');
  });

  it('adds protocol fallback for URL-like input without scheme', async () => {
    fetchTranscriptMock.mockResolvedValue([{ text: 'ok' }]);

    await service.getTranscript('youtube.com/watch?v=uWfgMi2_Slc');

    expect(fetchTranscriptMock).toHaveBeenCalledWith('uWfgMi2_Slc');
  });

  it('throws InvalidYouTubeVideoInputError for non-youtube or malformed input', async () => {
    await expect(service.getTranscript('https://vimeo.com/123')).rejects.toBeInstanceOf(
      InvalidYouTubeVideoInputError,
    );
    await expect(service.getTranscript('not-a-valid-id')).rejects.toBeInstanceOf(
      InvalidYouTubeVideoInputError,
    );
    await expect(service.getTranscript('   ')).rejects.toBeInstanceOf(
      InvalidYouTubeVideoInputError,
    );
  });

  it('wraps SDK failures with YouTubeTranscriptFetchError', async () => {
    fetchTranscriptMock.mockRejectedValue(new Error('SDK failure'));

    await expect(service.getTranscript('uWfgMi2_Slc')).rejects.toBeInstanceOf(
      YouTubeTranscriptFetchError,
    );
  });
});
