import { Injectable, Logger } from '@nestjs/common';
import { LLMService } from '../llm/llm.service';
import { LLMProvider, MessageRole } from '../llm/interfaces';
import { SEARCH_KEYWORDS_SYSTEM_PROMPT } from './prompts';
import { ResponseParserService } from '../llm/parsers/responseParser.service';
import { ActorsService } from '../actors/actors.service';
import { delay } from '../common/HelperFn';

@Injectable()
export class AgentService {
  private logger: Logger;
  constructor(
    private llmService: LLMService,
    private actorsService: ActorsService,
    private parser: ResponseParserService,
  ) {
    this.logger = new Logger(AgentService.name);
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
