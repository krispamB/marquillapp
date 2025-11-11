import { Injectable } from '@nestjs/common';
import { LLMFactoryService } from './llmFactory.service';
import { CompletionOptions, LLMMessage, LLMProvider } from './interfaces';

@Injectable()
export class LLMService {
  constructor(private llmFactory: LLMFactoryService) {}

  async generateCompletions(
    provider: LLMProvider,
    messages: Array<LLMMessage>,
    options?: CompletionOptions,
  ): Promise<string> {
    const strategy = this.llmFactory.getStrategy(provider);
    return strategy.generateCompletion(messages, options);
  }
}
