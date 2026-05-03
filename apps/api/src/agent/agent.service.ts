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
import { youtube, youtube_v3 } from '@googleapis/youtube';
import { delay } from '../common/HelperFn';
import { ConfigService } from '@nestjs/config';
import {
  CompressionResult,
  TranscriptResult,
  UserIntent,
  YoutubeSearchResult,
} from './agent.interface';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PostDraft } from 'src/database/schemas';
import { YoutubeTranscriptService } from '../youtube-transcript/youtube-transcript.service';

@Injectable()
export class AgentService {
  private logger: Logger;
  private youtube: youtube_v3.Youtube;
  constructor(
    private llmService: LLMService,
    private actorsService: ActorsService,
    private parser: ResponseParserService,
    private config: ConfigService,
    private youtubeTranscriptService: YoutubeTranscriptService,
    @InjectModel(PostDraft.name) private draftModel: Model<PostDraft>,
  ) {
    this.logger = new Logger(AgentService.name);
    const apiKey = this.config.get<string>('GOOGLE_API_KEY');
    if (!apiKey) {
      throw new Error('YOUTUBE_API_KEY is not configured');
    }
    this.youtube = youtube({ version: 'v3', auth: apiKey });
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

  async generateSearchKeywords(input: UserIntent): Promise<string> {
    const response = await this.llmService.generateCompletions(
      LLMProvider.OPENROUTER,
      [
        { role: MessageRole.System, content: SEARCH_KEYWORDS_SYSTEM_PROMPT },
        { role: MessageRole.User, content: JSON.stringify(input) },
      ],
      { model: 'google/gemini-3-flash-preview' },
    );

    return this.normalizeYoutubeQuery(response);
  }

  async searchYoutube(
    query: string,
    maxResults = 2,
  ): Promise<YoutubeSearchResult[]> {
    const normalizedQuery = this.normalizeYoutubeQuery(query);
    this.logger.log(normalizedQuery);
    try {
      if (!normalizedQuery) {
        this.logger.warn('Skipping YouTube search because query is empty');
        return [];
      }

      const mapResults = (items: youtube_v3.Schema$SearchResult[]) =>
        items.slice(0, maxResults).map((item) => ({
          videoId: item.id?.videoId || '',
          title: item.snippet?.title || 'No title',
          thumbnail: item.snippet?.thumbnails?.high?.url || '',
          channelTitle: item.snippet?.channelTitle || '',
          publishedAt: item.snippet?.publishedAt || '',
        }));

      const runSearch = (searchQuery: string) =>
        this.youtube.search.list({
          part: ['snippet'],
          q: searchQuery,
          type: ['video'],
          maxResults,
          order: 'relevance',
          videoDuration: 'medium',
          // videoCaption: 'closedCaption',
        });

      const response = await runSearch(normalizedQuery);
      const items = response.data.items || [];
      if (items.length > 0) {
        return mapResults(items);
      }

      this.logger.warn(`No results found for query: ${normalizedQuery}`);
      return [];
    } catch (error) {
      this.logger.error(
        `YouTube search failed: ${error?.message}`,
        error.stack,
      );
      throw new Error('Failed to search YouTube videos');
    }
  }

  private normalizeYoutubeQuery(query: string): string {
    const firstSegment =
      query
        .split('|')
        .map((segment) => segment.trim())
        .find((segment) => segment.length > 0) ?? '';
    const withoutWrappingQuotes = firstSegment
      .replace(/^["']+/, '')
      .replace(/["']+$/, '')
      .trim();

    return withoutWrappingQuotes.replace(/\s+/g, ' ');
  }
  async searchWithFallbacks(
    query: string,
    targetCount: number = 4,
  ): Promise<YoutubeSearchResult[]> {
    const seen = new Set<string>();
    const result: YoutubeSearchResult[] = [];

    const videos = await this.searchYoutube(query, 10);

    for (const video of videos) {
      if (result.length >= targetCount) break;

      if (!video.videoId || seen.has(video.videoId)) continue;

      seen.add(video.videoId);
      result.push(video);
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
      const transcript =
        await this.youtubeTranscriptService.getTranscript(url);
      return { title: video.title, transcript };
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
      { model: 'openai/gpt-5.4' },
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
