import { Global, Module } from '@nestjs/common';
import { LLMService } from './llm.service';
import { LLMFactoryService } from './llmFactory.service';
import { AnthropicStrategy, OpenRouterStrategy } from './strategies';
import { ResponseParserService } from './parsers/responseParser.service';

@Global()
@Module({
  providers: [
    LLMService,
    LLMFactoryService,
    OpenRouterStrategy,
    AnthropicStrategy,
    ResponseParserService,
  ],
  exports: [LLMService, ResponseParserService],
})
export class LlmModule {}
