import { LLMProvider } from './interfaces';

/**
 * Reads `LLM_PROVIDER`: which provider `AgentRunnerService` sends every model
 * call to. Unset or blank is `openrouter`; `anthropic` calls the Anthropic
 * API directly. Anything else throws, so a typo fails boot instead of
 * silently falling back.
 */
export const readLlmProvider = (
  raw: string | number | null | undefined,
): LLMProvider => {
  const value =
    raw === undefined || raw === null ? '' : String(raw).trim().toLowerCase();
  if (value === '' || value === 'openrouter') return LLMProvider.OPENROUTER;
  if (value === 'anthropic') return LLMProvider.ANTHROPIC;
  throw new Error(
    `LLM_PROVIDER must be openrouter or anthropic, or unset; got "${String(raw)}"`,
  );
};
