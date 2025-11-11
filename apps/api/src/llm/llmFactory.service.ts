import { OpenRouterStrategy } from './strategies';
import { LLMProvider } from './interfaces';
import { Injectable } from '@nestjs/common';

@Injectable()
export class LLMFactoryService {
  constructor(private openrouterStrategy: OpenRouterStrategy) {}

  getStrategy(provider: LLMProvider) {
    switch (provider) {
      case LLMProvider.OPENROUTER:
        return this.openrouterStrategy;
      default:
        throw new Error(`Unsupported LLM provider: ${provider}`);
    }
  }
}
