/**
 * Anthropic list prices, owned here because the Messages API returns token
 * counts but no dollar cost. `AnthropicStrategy` turns each response's
 * `usage` into `Usage.cost` with `anthropicCostUsd`, and the credit meter
 * bills that cost like any other provider's.
 *
 * To change a price, or add a model: edit `ANTHROPIC_PRICES` (USD per
 * million tokens) and its spec, from the pricing page
 * (https://platform.claude.com/docs/en/about-claude/pricing). A model that is
 * not listed costs `0`, which the meter bills at its flat per-token fallback
 * and logs; `AnthropicStrategy` warns once per unlisted model. See
 * `docs/anthropic-provider-design.md`.
 */

/** One tier of a model's rates, USD per million tokens. */
export interface AnthropicRates {
  inputPerMTok: number;
  outputPerMTok: number;
  /** Prompt tokens read from the cache. */
  cacheReadPerMTok: number;
  /** Prompt tokens written to the 5-minute cache (1.25x input). */
  cacheWritePerMTok: number;
}

export interface AnthropicPrice extends AnthropicRates {
  /**
   * Rates for a request whose prompt (fresh, cache-read and cache-write
   * tokens together) is over `thresholdTokens`.
   */
  longPrompt?: AnthropicRates & { thresholdTokens: number };
}

/** A 1-hour cache write costs twice the input rate. */
const ONE_HOUR_CACHE_WRITE_MULTIPLIER = 2;

/** Server-side web search: $10 per 1,000 searches. Result tokens bill as input. */
export const WEB_SEARCH_USD_PER_REQUEST = 0.01;

/** Keyed by the API model id (`toAnthropicModelId`). */
export const ANTHROPIC_PRICES: Readonly<Record<string, AnthropicPrice>> = {
  'claude-haiku-5-5': {
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    cacheReadPerMTok: 0.01,
    cacheWritePerMTok: 0.125,
    longPrompt: {
      thresholdTokens: 100_000,
      inputPerMTok: 0.5,
      outputPerMTok: 2.5,
      cacheReadPerMTok: 0.05,
      cacheWritePerMTok: 0.625,
    },
  },
  'claude-sonnet-5-5': {
    inputPerMTok: 2,
    outputPerMTok: 10,
    cacheReadPerMTok: 0.2,
    cacheWritePerMTok: 2.5,
  },
  'claude-opus-5-5': {
    inputPerMTok: 4,
    outputPerMTok: 20,
    cacheReadPerMTok: 0.2,
    cacheWritePerMTok: 5,
  },
};

/** The counts one Messages response reports in `usage`. */
export interface AnthropicUsageCounts {
  /** Fresh (uncached) prompt tokens. */
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  /** Every cache write, whatever its TTL. */
  cacheCreationInputTokens?: number;
  /** The part of `cacheCreationInputTokens` written with the 1-hour TTL. */
  cacheCreation1hInputTokens?: number;
  webSearchRequests?: number;
}

/**
 * One response's USD cost, or `undefined` when the model has no price. The
 * tier is decided per request, by the whole prompt.
 */
export const anthropicCostUsd = (
  model: string,
  usage: AnthropicUsageCounts,
): number | undefined => {
  const price = ANTHROPIC_PRICES[model];
  if (!price) return undefined;

  const cacheRead = usage.cacheReadInputTokens ?? 0;
  const cacheWrite = usage.cacheCreationInputTokens ?? 0;
  const cacheWrite1h = Math.min(
    usage.cacheCreation1hInputTokens ?? 0,
    cacheWrite,
  );
  const promptTokens = usage.inputTokens + cacheRead + cacheWrite;
  const rates =
    price.longPrompt && promptTokens > price.longPrompt.thresholdTokens
      ? price.longPrompt
      : price;

  const tokenUsd =
    usage.inputTokens * rates.inputPerMTok +
    usage.outputTokens * rates.outputPerMTok +
    cacheRead * rates.cacheReadPerMTok +
    (cacheWrite - cacheWrite1h) * rates.cacheWritePerMTok +
    cacheWrite1h * rates.inputPerMTok * ONE_HOUR_CACHE_WRITE_MULTIPLIER;

  return (
    tokenUsd / 1_000_000 +
    (usage.webSearchRequests ?? 0) * WEB_SEARCH_USD_PER_REQUEST
  );
};
