import {
  ANTHROPIC_PRICES,
  WEB_SEARCH_USD_PER_REQUEST,
  anthropicCostUsd,
} from './anthropic-pricing';

describe('anthropicPricing', () => {
  describe('anthropicCostUsd', () => {
    it('should price input and output tokens when the model is Haiku 5.5', () => {
      // 10k * $0.10/MTok + 2k * $0.50/MTok
      expect(
        anthropicCostUsd('claude-haiku-5-5', {
          inputTokens: 10_000,
          outputTokens: 2_000,
        }),
      ).toBeCloseTo(0.001 + 0.001, 10);
    });

    it('should price cache reads at 0.1x and 5-minute cache writes at 1.25x input when the model is Haiku 5.5', () => {
      // 1k * 0.10 + 10k * 0.01 + 4k * 0.125, per MTok
      expect(
        anthropicCostUsd('claude-haiku-5-5', {
          inputTokens: 1_000,
          outputTokens: 0,
          cacheReadInputTokens: 10_000,
          cacheCreationInputTokens: 4_000,
        }),
      ).toBeCloseTo(0.0001 + 0.0001 + 0.0005, 10);
    });

    it('should price 1-hour cache writes at 2x input when the response splits them out', () => {
      // 4k written: 1k at 5 minutes (0.125), 3k at 1 hour (0.20), per MTok
      expect(
        anthropicCostUsd('claude-haiku-5-5', {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationInputTokens: 4_000,
          cacheCreation1hInputTokens: 3_000,
        }),
      ).toBeCloseTo(0.000125 + 0.0006, 10);
    });

    it('should use the long-prompt Haiku rates when the prompt is over 100K tokens', () => {
      // 150k * $0.50/MTok + 1k * $2.50/MTok
      expect(
        anthropicCostUsd('claude-haiku-5-5', {
          inputTokens: 150_000,
          outputTokens: 1_000,
        }),
      ).toBeCloseTo(0.075 + 0.0025, 10);
    });

    it('should count cached prompt tokens toward the 100K threshold when deciding the Haiku tier', () => {
      // 60k fresh + 50k read = 110k prompt: long tier (0.50 in, 0.05 read)
      expect(
        anthropicCostUsd('claude-haiku-5-5', {
          inputTokens: 60_000,
          outputTokens: 0,
          cacheReadInputTokens: 50_000,
        }),
      ).toBeCloseTo(0.03 + 0.0025, 10);
    });

    it('should keep the standard Haiku rates when the prompt is exactly 100K tokens', () => {
      expect(
        anthropicCostUsd('claude-haiku-5-5', {
          inputTokens: 100_000,
          outputTokens: 0,
        }),
      ).toBeCloseTo(0.01, 10);
    });

    it('should price Sonnet 5.5 at $2 / $10 with $0.20 reads and $2.50 writes', () => {
      expect(
        anthropicCostUsd('claude-sonnet-5-5', {
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
          cacheReadInputTokens: 1_000_000,
          cacheCreationInputTokens: 1_000_000,
        }),
      ).toBeCloseTo(2 + 10 + 0.2 + 2.5, 10);
    });

    it('should price Opus 5.5 at $4 / $20 with $0.20 reads and $5 writes', () => {
      expect(
        anthropicCostUsd('claude-opus-5-5', {
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
          cacheReadInputTokens: 1_000_000,
          cacheCreationInputTokens: 1_000_000,
        }),
      ).toBeCloseTo(4 + 20 + 0.2 + 5, 10);
    });

    it('should add $0.01 per web search request when the model searched', () => {
      expect(WEB_SEARCH_USD_PER_REQUEST).toBe(0.01);
      expect(
        anthropicCostUsd('claude-haiku-5-5', {
          inputTokens: 0,
          outputTokens: 0,
          webSearchRequests: 3,
        }),
      ).toBeCloseTo(0.03, 10);
    });

    it('should return undefined when the model has no price', () => {
      expect(
        anthropicCostUsd('claude-unknown-9', {
          inputTokens: 1_000,
          outputTokens: 1_000,
        }),
      ).toBeUndefined();
    });

    it('should list only models with every rate set', () => {
      for (const price of Object.values(ANTHROPIC_PRICES)) {
        for (const tier of [price, price.longPrompt].filter(Boolean)) {
          expect(tier!.inputPerMTok).toBeGreaterThan(0);
          expect(tier!.outputPerMTok).toBeGreaterThan(0);
          expect(tier!.cacheReadPerMTok).toBeGreaterThan(0);
          expect(tier!.cacheWritePerMTok).toBeGreaterThan(0);
        }
      }
    });
  });
});
