import { Injectable } from '@nestjs/common';
import { LLMService } from '../llm/llm.service';
import { LLMProvider, MessageRole } from '../llm/interfaces';
import { SEARCH_KEYWORDS_SYSTEM_PROMPT } from './prompts';
import { ResponseParserService } from '../llm/parsers/responseParser.service';
import { ActorsService } from '../actors/actors.service';

@Injectable()
export class AgentService {
  constructor(
    private llmService: LLMService,
    private actorsService: ActorsService,
    private parser: ResponseParserService,
  ) {}

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
}
