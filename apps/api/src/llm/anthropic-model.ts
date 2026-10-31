/**
 * Turns a configured model id into the Anthropic API's own, so the same
 * `GENERATION_MODEL` / `RESEARCH_MODEL` values work under either provider:
 * an OpenRouter id (`anthropic/claude-haiku-5.5`) loses its `anthropic/`
 * prefix and any `:variant` suffix, and its version dots become dashes
 * (`claude-haiku-5-5`). An API id passes through unchanged. Anything that is
 * not a Claude model throws, naming the value.
 */
export const toAnthropicModelId = (raw: string): string => {
  let id = raw.trim();
  const slash = id.indexOf('/');
  if (slash !== -1) {
    if (id.slice(0, slash).toLowerCase() !== 'anthropic') {
      throw notAnthropic(raw);
    }
    id = id.slice(slash + 1);
  }
  id = id.split(':')[0].replace(/\./g, '-');
  if (!/^claude-[a-z0-9-]+$/.test(id)) throw notAnthropic(raw);
  return id;
};

const notAnthropic = (raw: string): Error =>
  new Error(`"${raw}" is not an Anthropic model id`);

/**
 * Models whose web search tool supports dynamic filtering
 * (`web_search_20260209`); every other model gets the basic
 * `web_search_20250305`. From the Claude API docs' dynamic-filtering list,
 * which does not include Haiku.
 */
const DYNAMIC_FILTERING_MODELS = new Set([
  'claude-fable-5-1',
  'claude-mythos-5-1',
  'claude-fable-5',
  'claude-mythos-5',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-5-5',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
]);

export type WebSearchToolType = 'web_search_20260209' | 'web_search_20250305';

export const webSearchToolType = (model: string): WebSearchToolType =>
  DYNAMIC_FILTERING_MODELS.has(model)
    ? 'web_search_20260209'
    : 'web_search_20250305';
