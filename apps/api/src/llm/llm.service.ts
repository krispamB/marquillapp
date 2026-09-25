import { Injectable } from '@nestjs/common';
import { LLMFactoryService } from './llmFactory.service';
import {
  CompletionOptions,
  CompletionResult,
  LLMMessage,
  LLMProvider,
  ToolDefinition,
  ToolTurnResult,
} from './interfaces';

@Injectable()
export class LLMService {
  constructor(private llmFactory: LLMFactoryService) {}

  async complete(
    provider: LLMProvider,
    messages: Array<LLMMessage>,
    options?: CompletionOptions,
  ): Promise<CompletionResult> {
    const strategy = this.llmFactory.getStrategy(provider);
    return strategy.complete(messages, options);
  }

  /** One turn only. The caller executes the returned tool calls. */
  async completeWithTools(
    provider: LLMProvider,
    messages: Array<LLMMessage>,
    tools: Array<ToolDefinition>,
    options?: CompletionOptions,
  ): Promise<ToolTurnResult> {
    const strategy = this.llmFactory.getStrategy(provider);
    return strategy.completeWithTools(messages, tools, options);
  }

  /** @deprecated Use `complete`, which also reports usage. */
  async generateCompletions(
    provider: LLMProvider,
    messages: Array<LLMMessage>,
    options?: CompletionOptions,
  ): Promise<string> {
    const strategy = this.llmFactory.getStrategy(provider);
    return strategy.generateCompletion(messages, options);
  }
}
