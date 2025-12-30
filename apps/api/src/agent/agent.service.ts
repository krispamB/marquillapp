import { Injectable, Logger } from '@nestjs/common';
import { LLMService } from '../llm/llm.service';
import { LLMProvider, MessageRole } from '../llm/interfaces';
import { SEARCH_KEYWORDS_SYSTEM_PROMPT } from './prompts';
import { ResponseParserService } from '../llm/parsers/responseParser.service';
import { ActorsService } from '../actors/actors.service';
import { google, youtube_v3 } from 'googleapis';
import { delay } from '../common/HelperFn';
import { ConfigService } from '@nestjs/config';
import { YoutubeSearchResult } from './agent.interface';
import { HttpService } from '@nestjs/axios';
import { Supadata } from '@supadata/js';

@Injectable()
export class AgentService {
  private logger: Logger;
  private youtube: youtube_v3.Youtube;
  private supadata: Supadata;
  constructor(
    private llmService: LLMService,
    private actorsService: ActorsService,
    private parser: ResponseParserService,
    private config: ConfigService,
    private http: HttpService,
  ) {
    this.logger = new Logger(AgentService.name);
    const apiKey = this.config.get<string>('GOOGLE_API_KEY');
    if (!apiKey) {
      throw new Error('YOUTUBE_API_KEY is not configured');
    }
    this.youtube = google.youtube({
      version: 'v3',
      auth: apiKey,
    });

    this.supadata = new Supadata({
      apiKey: this.config.get<string>('SUPADATA_KEY')!,
    });
  }

  async generateSearchKeywords(input: string): Promise<string[]> {
    const response = await this.llmService.generateCompletions(
      LLMProvider.OPENROUTER,
      [
        { role: MessageRole.System, content: SEARCH_KEYWORDS_SYSTEM_PROMPT },
        { role: MessageRole.User, content: input },
      ],
    );

    return this.parser.parseArray<string>(response);
  }

  async searchYoutube(
    query: string,
    maxResults = 5,
  ): Promise<YoutubeSearchResult[]> {
    try {
      const response = await this.youtube.search.list({
        part: ['snippet'],
        q: query,
        type: ['video'],
        maxResults,
        order: 'relevance',
        videoDuration: 'long',
      });

      if (!response.data.items || response.data.items.length === 0) {
        this.logger.warn(`No results found for query: ${query}`);
        return [];
      }

      return response.data.items?.map((item) => ({
        videoId: item.id?.videoId || '',
        title: item.snippet?.title || 'No title',
        thumbnail: item.snippet?.thumbnails?.high?.url || '',
        channelTitle: item.snippet?.channelTitle || '',
        publishedAt: item.snippet?.publishedAt || '',
      }));
    } catch (error) {
      this.logger.error(
        `YouTube search failed: ${error?.message}`,
        error.stack,
      );
      throw new Error('Failed to search YouTube videos');
    }
  }
  async searchWithFallbacks(queries: string[]): Promise<YoutubeSearchResult[]> {
    const seen = new Set<string>();
    const result: YoutubeSearchResult[] = [];
    for (const query of queries) {
      const videos = await this.searchYoutube(query);
      for (const video of videos) {
        if (!video.videoId || seen.has(video.videoId)) continue;

        seen.add(video.videoId);
        result.push(video);
      }

      if (result.length >= 5) break;
    }
    return result;
  }

  async getYouTubeTranscripts(input: string[]) {
    const videos = await this.searchWithFallbacks(input);
    this.logger.log({ videos });
    const transcripts: string[] = [];
    for (const video of videos) {
      const transcript = await this.extractYtTranscript(video.videoId);
      if (transcript) transcripts.push(transcript);
    }
    return transcripts;
  }

  async extractYtTranscript(videoId: string): Promise<string | null> {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    try {
      const transcriptResult = await this.supadata.transcript({
        url,
        lang: 'en',
        text: true,
        mode: 'auto',
      });
      if ('jobId' in transcriptResult) {
        this.logger.log({ jobId: transcriptResult.jobId });
        return transcriptResult.jobId;
      } else {
        return transcriptResult.content as string;
      }
    } catch (err) {
      this.logger.error(err);
      return null;
    }
  }

  async research(input: string[]) {
    this.logger.debug('Researching search keywords for input', input);
    await delay(20000);
    this.logger.log(`Researching complete for ${input.length} keywords`);
    return input;
  }

  async createDraft(input) {
    await delay(10000);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return input;
  }
}
