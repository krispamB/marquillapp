import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LLMService } from './llm.service';
import { LLMFactoryService } from './llmFactory.service';
import { AnthropicStrategy } from './strategies/anthropic.strategy';
import { loadOpenRouterStrategy } from './openrouter-strategy.loader';
import { OPENROUTER_STRATEGY } from './openrouter-strategy.token';
import { ResponseParserService } from './parsers/responseParser.service';

@Global()
@Module({
  providers: [
    LLMService,
    LLMFactoryService,
    {
      provide: OPENROUTER_STRATEGY,
      useFactory: (config: ConfigService) => loadOpenRouterStrategy(config),
      inject: [ConfigService],
    },
    AnthropicStrategy,
    ResponseParserService,
  ],
  exports: [LLMService, ResponseParserService],
})
export class LlmModule {}
