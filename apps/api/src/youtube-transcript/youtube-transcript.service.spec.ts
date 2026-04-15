const fetchTranscriptMock = jest.fn();

// Helper to create named SDK errors that match what the service checks via constructor.name
function sdkError(name: string): Error {
  class SdkError extends Error {
    constructor() {
      super(name);
    }
  }
  Object.defineProperty(SdkError, 'name', { value: name });
  return new SdkError();
}

jest.mock('youtube-transcript-plus', () => ({
  fetchTranscript: fetchTranscriptMock,
}));

import {
  InvalidYouTubeVideoInputError,
  TranscriptDisabledError,
  TranscriptLanguageNotAvailableError,
  TranscriptNotAvailableError,
  TranscriptRateLimitError,
  TranscriptVideoUnavailableError,
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
      { text: 'Hello\n', offset: 0, duration: 1, lang: 'en' },
      { text: '   world   ', offset: 1, duration: 1, lang: 'en' },
    ]);

    const result = await service.getTranscript('uWfgMi2_Slc');

    expect(fetchTranscriptMock).toHaveBeenCalledWith('uWfgMi2_Slc', {
      lang: 'en',
    });
    expect(result).toBe('Hello world');
  });

  it('accepts youtube.com watch URL', async () => {
    fetchTranscriptMock.mockResolvedValue([
      { text: 'Transcript text', offset: 0, duration: 1, lang: 'en' },
    ]);

    const result = await service.getTranscript(
      'https://www.youtube.com/watch?v=uWfgMi2_Slc',
    );

    expect(fetchTranscriptMock).toHaveBeenCalledWith('uWfgMi2_Slc', {
      lang: 'en',
    });
    expect(result).toBe('Transcript text');
  });

  it('accepts youtu.be URL', async () => {
    fetchTranscriptMock.mockResolvedValue([
      { text: 'Short url transcript', offset: 0, duration: 1, lang: 'en' },
    ]);

    const result = await service.getTranscript('https://youtu.be/uWfgMi2_Slc');

    expect(fetchTranscriptMock).toHaveBeenCalledWith('uWfgMi2_Slc', {
      lang: 'en',
    });
    expect(result).toBe('Short url transcript');
  });

  it('accepts shorts and embed URLs', async () => {
    fetchTranscriptMock.mockResolvedValue([
      { text: 'ok', offset: 0, duration: 1, lang: 'en' },
    ]);

    await service.getTranscript('https://www.youtube.com/shorts/uWfgMi2_Slc');
    await service.getTranscript('https://www.youtube.com/embed/uWfgMi2_Slc');

    expect(fetchTranscriptMock).toHaveBeenNthCalledWith(1, 'uWfgMi2_Slc', {
      lang: 'en',
    });
    expect(fetchTranscriptMock).toHaveBeenNthCalledWith(2, 'uWfgMi2_Slc', {
      lang: 'en',
    });
  });

  it('adds protocol fallback for URL-like input without scheme', async () => {
    fetchTranscriptMock.mockResolvedValue([
      { text: 'ok', offset: 0, duration: 1, lang: 'en' },
    ]);

    await service.getTranscript('youtube.com/watch?v=uWfgMi2_Slc');

    expect(fetchTranscriptMock).toHaveBeenCalledWith('uWfgMi2_Slc', {
      lang: 'en',
    });
  });

  it('forwards the lang parameter to fetchTranscript', async () => {
    fetchTranscriptMock.mockResolvedValue([
      { text: 'Hola', offset: 0, duration: 1, lang: 'es' },
    ]);

    const result = await service.getTranscript('uWfgMi2_Slc', 'es');

    expect(fetchTranscriptMock).toHaveBeenCalledWith('uWfgMi2_Slc', {
      lang: 'es',
    });
    expect(result).toBe('Hola');
  });

  it('throws InvalidYouTubeVideoInputError for non-youtube or malformed input', async () => {
    await expect(
      service.getTranscript('https://vimeo.com/123'),
    ).rejects.toBeInstanceOf(InvalidYouTubeVideoInputError);
    await expect(
      service.getTranscript('not-a-valid-id'),
    ).rejects.toBeInstanceOf(InvalidYouTubeVideoInputError);
    await expect(service.getTranscript('   ')).rejects.toBeInstanceOf(
      InvalidYouTubeVideoInputError,
    );
  });

  it('throws TranscriptDisabledError when transcripts are disabled', async () => {
    fetchTranscriptMock.mockRejectedValue(
      sdkError('YoutubeTranscriptDisabledError'),
    );

    await expect(
      service.getTranscript('uWfgMi2_Slc'),
    ).rejects.toBeInstanceOf(TranscriptDisabledError);
  });

  it('throws TranscriptVideoUnavailableError when video is unavailable', async () => {
    fetchTranscriptMock.mockRejectedValue(
      sdkError('YoutubeTranscriptVideoUnavailableError'),
    );

    await expect(
      service.getTranscript('uWfgMi2_Slc'),
    ).rejects.toBeInstanceOf(TranscriptVideoUnavailableError);
  });

  it('throws TranscriptRateLimitError when rate-limited', async () => {
    fetchTranscriptMock.mockRejectedValue(
      sdkError('YoutubeTranscriptTooManyRequestError'),
    );

    await expect(
      service.getTranscript('uWfgMi2_Slc'),
    ).rejects.toBeInstanceOf(TranscriptRateLimitError);
  });

  it('throws TranscriptNotAvailableError when no transcript exists', async () => {
    fetchTranscriptMock.mockRejectedValue(
      sdkError('YoutubeTranscriptNotAvailableError'),
    );

    await expect(
      service.getTranscript('uWfgMi2_Slc'),
    ).rejects.toBeInstanceOf(TranscriptNotAvailableError);
  });

  it('throws TranscriptLanguageNotAvailableError when lang is missing', async () => {
    fetchTranscriptMock.mockRejectedValue(
      sdkError('YoutubeTranscriptNotAvailableLanguageError'),
    );

    await expect(
      service.getTranscript('uWfgMi2_Slc', 'fr'),
    ).rejects.toBeInstanceOf(TranscriptLanguageNotAvailableError);
  });

  it('wraps unrecognised SDK failures with YouTubeTranscriptFetchError', async () => {
    fetchTranscriptMock.mockRejectedValue(new Error('Unknown SDK failure'));

    await expect(service.getTranscript('uWfgMi2_Slc')).rejects.toBeInstanceOf(
      YouTubeTranscriptFetchError,
    );
  });
});
