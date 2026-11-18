import { ConfigService } from '@nestjs/config';
import { LLMProvider, type LLMStrategy } from './interfaces';
import { readLlmProvider } from './llm-provider';

/**
 * Builds the OpenRouter strategy only when this process will use it.
 *
 * Unset `LLM_PROVIDER` is OpenRouter, so the SDK loads in that case. `anthropic`
 * returns null. The `require` stays inside the function: a top-level import
 * would evaluate `openrouter.strategy`, which pulls `@openrouter/sdk` into
 * the process.
 */
export function loadOpenRouterStrategy(
  config: ConfigService,
): LLMStrategy | null {
  const provider = readLlmProvider(config.get<string>('LLM_PROVIDER'));
  if (provider !== LLMProvider.OPENROUTER) return null;

  const { OpenRouterStrategy } =
    require('./strategies/openrouter.strategy') as typeof import('./strategies/openrouter.strategy');
  return new OpenRouterStrategy(config);
}
