import { Injectable } from '@nestjs/common';
import { YoutubeTranscript } from '@danielxceron/youtube-transcript';

const YOUTUBE_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

export class InvalidYouTubeVideoInputError extends Error {
  constructor(input: string) {
    super(`Invalid YouTube video URL or ID: ${input}`);
    this.name = 'InvalidYouTubeVideoInputError';
  }
}

export class YouTubeTranscriptFetchError extends Error {
  constructor(input: string, cause?: unknown) {
    super(`Failed to fetch transcript for input: ${input}`);
    this.name = 'YouTubeTranscriptFetchError';
    (this as Error & { cause?: unknown }).cause = cause;
  }
}

@Injectable()
export class YoutubeTranscriptService {
  async getTranscript(input: string): Promise<string> {
    const videoId = this.extractVideoId(input);

    try {
      const transcriptParts = await YoutubeTranscript.fetchTranscript(videoId);
      return transcriptParts
        .map((part) => part.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    } catch (error) {
      throw new YouTubeTranscriptFetchError(input, error);
    }
  }

  private extractVideoId(input: string): string {
    const trimmedInput = input.trim();
    if (!trimmedInput) {
      throw new InvalidYouTubeVideoInputError(input);
    }

    if (YOUTUBE_ID_PATTERN.test(trimmedInput)) {
      return trimmedInput;
    }

    const parsedUrl = this.parseYoutubeUrl(trimmedInput);
    if (!parsedUrl) {
      throw new InvalidYouTubeVideoInputError(input);
    }

    const videoId = this.getVideoIdFromUrl(parsedUrl);
    if (!videoId) {
      throw new InvalidYouTubeVideoInputError(input);
    }

    return videoId;
  }

  private parseYoutubeUrl(input: string): URL | null {
    const candidates = [input];
    if (!/^https?:\/\//i.test(input)) {
      candidates.push(`https://${input}`);
    }

    for (const candidate of candidates) {
      try {
        const url = new URL(candidate);
        if (this.isYoutubeHost(url.hostname)) {
          return url;
        }
      } catch {
        // Try the next candidate.
      }
    }

    return null;
  }

  private isYoutubeHost(hostname: string): boolean {
    const normalizedHost = hostname.toLowerCase();
    return (
      normalizedHost === 'youtube.com' ||
      normalizedHost.endsWith('.youtube.com') ||
      normalizedHost === 'youtu.be' ||
      normalizedHost.endsWith('.youtu.be')
    );
  }

  private getVideoIdFromUrl(url: URL): string | null {
    const pathnameParts = url.pathname.split('/').filter(Boolean);
    const host = url.hostname.toLowerCase();

    const vParam = url.searchParams.get('v');
    if (vParam && YOUTUBE_ID_PATTERN.test(vParam)) {
      return vParam;
    }

    if (host.includes('youtu.be')) {
      const shortId = pathnameParts[0];
      if (shortId && YOUTUBE_ID_PATTERN.test(shortId)) {
        return shortId;
      }
    }

    if (host.includes('youtube.com')) {
      const prefix = pathnameParts[0];
      const candidate = pathnameParts[1];
      if (
        prefix &&
        candidate &&
        ['embed', 'shorts', 'live', 'v'].includes(prefix) &&
        YOUTUBE_ID_PATTERN.test(candidate)
      ) {
        return candidate;
      }
    }

    return null;
  }
}
