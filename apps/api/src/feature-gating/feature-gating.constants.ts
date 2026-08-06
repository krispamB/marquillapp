export const FEATURE_KEYS = {
  CREDITS: 'credits',
  RESEARCH: 'research',
  CONNECTED_ACCOUNTS: 'connected_accounts',
  SCHEDULED_POSTS: 'scheduled_posts',
} as const;

export type FeatureKey = (typeof FEATURE_KEYS)[keyof typeof FEATURE_KEYS];

export const FEATURE_GATE_ERROR_CODE = 'FEATURE_LIMIT_EXCEEDED';
