import { Injectable, Logger } from '@nestjs/common';
import { LLMService } from '../llm/llm.service';
import { LLMProvider, MessageRole } from '../llm/interfaces';
import {
  CREATE_DRAFT_SYSTEM_PROMPT,
  CREATE_LINKEDIN_POST_SYSTEM_PROMPT,
  SEARCH_KEYWORDS_SYSTEM_PROMPT,
  TRANSCRIPT_COMPRESSIONS_SYSTEM_PROMPT,
  USER_INTENT_SYSTEM_PROMPT,
} from './prompts';
import { ResponseParserService } from '../llm/parsers/responseParser.service';
import { ActorsService } from '../actors/actors.service';
import { google, youtube_v3 } from 'googleapis';
import { delay } from '../common/HelperFn';
import { ConfigService } from '@nestjs/config';
import {
  CompressionResult,
  TranscriptResult,
  UserIntent,
  YoutubeSearchResult,
} from './agent.interface';
import { HttpService } from '@nestjs/axios';
import { Supadata } from '@supadata/js';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PostDraft } from 'src/database/schemas';

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
    @InjectModel(PostDraft.name) private draftModel: Model<PostDraft>,
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

  async generateUserIntent(input: string) {
    const response = await this.llmService.generateCompletions(
      LLMProvider.OPENROUTER,
      [
        { role: MessageRole.System, content: USER_INTENT_SYSTEM_PROMPT },
        { role: MessageRole.User, content: input },
      ],
    );

    return this.parser.parseObject<UserIntent>(response);
  }

  async generateSearchKeywords(input: UserIntent): Promise<string[]> {
    const response = await this.llmService.generateCompletions(
      LLMProvider.OPENROUTER,
      [
        { role: MessageRole.System, content: SEARCH_KEYWORDS_SYSTEM_PROMPT },
        { role: MessageRole.User, content: JSON.stringify(input) },
      ],
    );

    return this.parser.parseArray<string>(response);
  }

  async searchYoutube(
    query: string,
    maxResults = 2,
  ): Promise<YoutubeSearchResult[]> {
    this.logger.log(query);
    try {
      const response = await this.youtube.search.list({
        part: ['snippet'],
        q: query,
        type: ['video'],
        maxResults,
        order: 'relevance',
        videoDuration: 'medium',
        videoCaption: 'closedCaption',
      });

      if (!response.data.items || response.data.items.length === 0) {
        this.logger.warn(`No results found for query: ${query}`);
        return [];
      }

      return response.data.items?.slice(0, maxResults).map((item) => ({
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
    const targetCount = 3;
    const seen = new Set<string>();
    const result: YoutubeSearchResult[] = [];
    for (const query of queries) {
      const videos = await this.searchYoutube(query, 2);
      for (const video of videos) {
        if (result.length >= targetCount) break;
        if (!video.videoId || seen.has(video.videoId)) continue;

        seen.add(video.videoId);
        result.push(video);
      }

      if (result.length >= targetCount) break;
    }
    return result;
  }

  async getYouTubeTranscripts(videos: YoutubeSearchResult[]) {
    const transcripts: TranscriptResult[] = [];
    for (const video of videos) {
      const transcript = await this.extractYtTranscript(video);
      if (transcript) transcripts.push(transcript);
    }
    return transcripts;
  }

  async extractYtTranscript(
    video: YoutubeSearchResult,
  ): Promise<TranscriptResult | null> {
    const url = `https://www.youtube.com/watch?v=${video.videoId}`;
    try {
      const transcriptResult = await this.supadata.transcript({
        url,
        lang: 'en',
        text: true,
        mode: 'native',
      });
      if ('jobId' in transcriptResult) {
        this.logger.log({ jobId: transcriptResult.jobId });
        return null;
      } else {
        return {
          title: video.title,
          transcript: transcriptResult.content as string,
        };
      }
    } catch (err) {
      this.logger.error(err);
      return null;
    }
  }

  async extractInsight(input: TranscriptResult[], userIntent: UserIntent) {
    const response = await this.llmService.generateCompletions(
      LLMProvider.OPENROUTER,
      [
        {
          role: MessageRole.System,
          content: TRANSCRIPT_COMPRESSIONS_SYSTEM_PROMPT,
        },
        { role: MessageRole.User, content: JSON.stringify(input) },
        { role: MessageRole.User, content: JSON.stringify(userIntent) },
      ],
    );

    return this.parser.parseObject<CompressionResult>(response);
  }

  async research(input: string[]) {
    this.logger.debug('Researching search keywords for input', input);
    await delay(20000);
    this.logger.log(`Researching complete for ${input.length} keywords`);
    return input;
  }

  async createLinkedInPost(
    userIntent: UserIntent,
    compressionResult?: CompressionResult,
  ) {
    const response = await this.llmService.generateCompletions(
      LLMProvider.OPENROUTER,
      [
        {
          role: MessageRole.System,
          content: CREATE_LINKEDIN_POST_SYSTEM_PROMPT,
        },
        { role: MessageRole.User, content: JSON.stringify(userIntent) },
        {
          role: MessageRole.User,
          content: JSON.stringify(compressionResult || {}),
        },
      ],
    );

    return response;
  }

  async createDraft(
    compressionResult: CompressionResult,
    userIntent: UserIntent,
  ) {
    const response = await this.llmService.generateCompletions(
      LLMProvider.OPENROUTER,
      [
        { role: MessageRole.System, content: CREATE_DRAFT_SYSTEM_PROMPT },
        { role: MessageRole.User, content: JSON.stringify(userIntent) },
        { role: MessageRole.User, content: JSON.stringify(compressionResult) },
      ],
    );

    return response;
  }

  async updateDraft(draftId: string, draft: Partial<PostDraft>) {
    return this.draftModel.updateOne({ _id: draftId }, draft);
  }
}
