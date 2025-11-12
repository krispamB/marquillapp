import { CompletionOptions, LLMMessage, LLMStrategy } from '../interfaces';
import { ConfigService } from '@nestjs/config';
import { OpenRouter } from '@openrouter/sdk';
import { Injectable, InternalServerErrorException } from '@nestjs/common';

@Injectable()
export class OpenRouterStrategy implements LLMStrategy {
  private client: OpenRouter;
  constructor(private config: ConfigService) {
    const apiKey = this.config.get<string>('OPENROUTER_API_KEY');
    if (!apiKey)
      throw new InternalServerErrorException(
        'OPENROUTER_API_KEY was not configured',
      );
    this.client = new OpenRouter({
      apiKey,
    });
  }
  async generateCompletion(
    messages: Array<LLMMessage>,
    options?: CompletionOptions,
  ): Promise<string> {
    const completions = await this.client.chat.send({
      model: options?.model || 'openai/gpt-4o-mini',
      maxTokens: options?.max_tokens,
      messages,
      stream: false,
    });

    const content = completions.choices[0].message.content;
    if (typeof content === 'string') return content;

    throw new Error(`Unsupported content type: ${typeof content}`);
  }
}
