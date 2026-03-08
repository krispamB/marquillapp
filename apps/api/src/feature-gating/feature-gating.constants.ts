export const FEATURE_KEYS = {
  AI_DRAFTS: 'ai_drafts',
  CONNECTED_ACCOUNTS: 'connected_accounts',
} as const;

export type FeatureKey = (typeof FEATURE_KEYS)[keyof typeof FEATURE_KEYS];

export const FEATURE_GATE_ERROR_CODE = 'FEATURE_LIMIT_EXCEEDED';
