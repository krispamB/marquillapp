import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  CREDIT_CONFIG_DEFAULTS,
  USAGE_KINDS,
  UsageDetail,
  UsageRecord,
} from './credit-meter.constants';
import { FeatureGatingService } from './feature-gating.service';

// Converts raw usage signals into credits and settles them against the period
// aggregate. The stateful, per-run half — the `creditsUsed` accumulator and its
// per-attempt reset — belongs to the workflow engine, not here.
@Injectable()
export class CreditMeterService {
  private readonly logger = new Logger(CreditMeterService.name);

  private readonly creditsPerUsd: number;
  private readonly markup: number;
  private readonly fallbackCreditsPer1kTokens: number;
  private readonly minimumPdfRenderCredits: number;
  private readonly surcharges: Record<'web_search' | 'pdf_render', number>;

  constructor(
    private readonly configService: ConfigService,
    private readonly featureGatingService: FeatureGatingService,
  ) {
    this.creditsPerUsd = this.readNumber(
      'CREDITS_PER_USD',
      CREDIT_CONFIG_DEFAULTS.CREDITS_PER_USD,
    );
    this.markup = this.readNumber(
      'CREDIT_MARKUP',
      CREDIT_CONFIG_DEFAULTS.CREDIT_MARKUP,
    );
    this.fallbackCreditsPer1kTokens = this.readNumber(
      'FALLBACK_CREDITS_PER_1K_TOKENS',
      CREDIT_CONFIG_DEFAULTS.FALLBACK_CREDITS_PER_1K_TOKENS,
    );
    this.surcharges = {
      web_search: this.readNumber(
        'CREDIT_SURCHARGE_WEB_SEARCH',
        CREDIT_CONFIG_DEFAULTS.CREDIT_SURCHARGE_WEB_SEARCH,
      ),
      pdf_render: this.readNumber(
        'CREDIT_SURCHARGE_PDF_RENDER',
        CREDIT_CONFIG_DEFAULTS.CREDIT_SURCHARGE_PDF_RENDER,
      ),
    };
    this.minimumPdfRenderCredits = this.readNumber(
      'CREDIT_MINIMUM_PDF_RENDER',
      CREDIT_CONFIG_DEFAULTS.CREDIT_MINIMUM_PDF_RENDER,
    );
  }

  // Pure and synchronous so `record` on the engine's meter stays non-async.
  toCredits(usage: UsageRecord): number {
    if (usage.kind === USAGE_KINDS.LLM) {
      return this.llmCredits(usage.amount, usage.detail);
    }

    if (usage.kind === USAGE_KINDS.PDF_RENDER) {
      if (!Number.isFinite(usage.amount) || usage.amount <= 0) return 0;
      return Math.max(
        this.toWholeCredits(usage.amount * this.surcharges.pdf_render),
        this.toWholeCredits(this.minimumPdfRenderCredits),
      );
    }

    const surcharge = this.surcharges[usage.kind];
    return this.toWholeCredits(usage.amount * surcharge);
  }

  assertBalance(userId: string): Promise<void> {
    return this.featureGatingService.assertBalance(userId);
  }

  debit(userId: string, credits: number): Promise<void> {
    return this.featureGatingService.debit(userId, credits);
  }

  private llmCredits(
    costUsd: number | undefined,
    detail?: UsageDetail,
  ): number {
    if (costUsd !== undefined && Number.isFinite(costUsd) && costUsd > 0) {
      return this.toWholeCredits(costUsd * this.creditsPerUsd * this.markup);
    }

    // OpenRouter always reports `usage.cost`, so this is a guard against a future
    // provider slipping through free rather than a path we expect to take.
    const totalTokens = detail?.totalTokens ?? 0;
    this.logger.warn(
      `LLM usage reported no cost; falling back to token pricing ` +
        `(model=${detail?.model ?? 'unknown'}, totalTokens=${totalTokens})`,
    );

    return this.toWholeCredits(
      (totalTokens / 1000) * this.fallbackCreditsPer1kTokens,
    );
  }

  private toWholeCredits(credits: number): number {
    if (!Number.isFinite(credits) || credits <= 0) return 0;
    return Math.ceil(credits);
  }

  private readNumber(key: string, fallback: number): number {
    const raw = this.configService.get<string | number>(key);
    if (raw === undefined || raw === null || raw === '') return fallback;

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
}
