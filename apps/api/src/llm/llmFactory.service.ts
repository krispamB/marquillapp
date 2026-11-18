import { Inject, Injectable, Optional } from '@nestjs/common';
import { AnthropicStrategy } from './strategies/anthropic.strategy';
import { LLMProvider, type LLMStrategy } from './interfaces';
import { OPENROUTER_STRATEGY } from './openrouter-strategy.token';

@Injectable()
export class LLMFactoryService {
  constructor(
    @Optional()
    @Inject(OPENROUTER_STRATEGY)
    private openrouterStrategy: LLMStrategy | null,
    private anthropicStrategy: AnthropicStrategy,
  ) {}

  getStrategy(provider: LLMProvider): LLMStrategy {
    switch (provider) {
      case LLMProvider.OPENROUTER:
        if (!this.openrouterStrategy) {
          throw new Error(
            'OpenRouter strategy is not loaded; LLM_PROVIDER is not openrouter',
          );
        }
        return this.openrouterStrategy;
      case LLMProvider.ANTHROPIC:
        return this.anthropicStrategy;
      default:
        throw new Error(`Unsupported LLM provider: ${provider}`);
    }
  }
}
