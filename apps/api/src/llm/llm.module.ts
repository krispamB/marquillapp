import { Global, Module } from '@nestjs/common';
import { LLMService } from './llm.service';
import { LLMFactoryService } from './llmFactory.service';
import { OpenRouterStrategy } from './strategies';
import { ResponseParserService } from './parsers/responseParser.service';

@Global()
@Module({
  providers: [
    LLMService,
    LLMFactoryService,
    OpenRouterStrategy,
    ResponseParserService,
  ],
  exports: [LLMService, ResponseParserService],
})
export class LlmModule {}
