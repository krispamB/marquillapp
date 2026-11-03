import { AnthropicStrategy, OpenRouterStrategy } from './strategies';
import { LLMProvider, type LLMStrategy } from './interfaces';
import { Injectable } from '@nestjs/common';

@Injectable()
export class LLMFactoryService {
  constructor(
    private openrouterStrategy: OpenRouterStrategy,
    private anthropicStrategy: AnthropicStrategy,
  ) {}

  getStrategy(provider: LLMProvider): LLMStrategy {
    switch (provider) {
      case LLMProvider.OPENROUTER:
        return this.openrouterStrategy;
      case LLMProvider.ANTHROPIC:
        return this.anthropicStrategy;
      default:
        throw new Error(`Unsupported LLM provider: ${provider}`);
    }
  }
}
