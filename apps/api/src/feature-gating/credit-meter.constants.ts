import type { BrowserlessUsage } from '../carousel/render-usage.types';

export const USAGE_KINDS = {
  LLM: 'llm',
  WEB_SEARCH: 'web_search',
  PDF_RENDER: 'pdf_render',
} as const;

export type UsageKind = (typeof USAGE_KINDS)[keyof typeof USAGE_KINDS];

// `amount` is polymorphic by `kind`: raw provider cost in USD for `llm`, a unit
// count for the flat-surcharge kinds. A provider may report no cost at all, so
// the `llm` arm accepts `undefined` and falls back to token pricing.
export type UsageRecord =
  | { kind: typeof USAGE_KINDS.LLM; amount?: number; detail?: UsageDetail }
  | {
      kind: Exclude<UsageKind, typeof USAGE_KINDS.LLM>;
      amount: number;
      detail?: UsageDetail;
    };

export interface UsageDetail {
  // Carried for display and audit only — priced from `totalTokens` solely when a
  // provider reports no cost.
  totalTokens?: number;
  model?: string;
  browserless?: BrowserlessUsage;
}

export const CREDIT_CONFIG_DEFAULTS = {
  CREDITS_PER_USD: 1000,
  CREDIT_MARKUP: 2.0,
  // Safety net only: sized above a frontier model's blended per-1k rate so a
  // provider that reports no cost cannot be cheaper than one that does.
  FALLBACK_CREDITS_PER_1K_TOKENS: 10,
  CREDIT_SURCHARGE_WEB_SEARCH: 32,
  CREDIT_SURCHARGE_PDF_RENDER: 4,
  CREDIT_MINIMUM_PDF_RENDER: 8,
} as const;
