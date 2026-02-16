export type TierLimits = {
  postsPerMonth?: number;
  toneAnalysis?: boolean;
  scheduling?: boolean;
};

export type TierMetadata = {
  description?: string;
  limits?: TierLimits;
};

export type Tier = {
  _id: string;
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
  isDefault: boolean;
  isActive: boolean;
  metadata?: TierMetadata;
  createdAt?: string;
  updatedAt?: string;
  __v?: number;
};

export type UserProfile = {
  name: string;
  email: string;
  avatar?: string;
  tier?: Tier | null;
};

export type UserApiResponse = UserProfile & {
  _id?: string;
  googleId?: string;
  createdAt?: string;
  updatedAt?: string;
  __v?: number;
};

export type ConnectedAccountProvider = "LINKEDIN" | (string & {});

export type ConnectedAccountProfile = {
  name?: string;
  email?: string;
  picture?: string;
};

export type ConnectedAccount = {
  id: string;
  provider: ConnectedAccountProvider;
  accessTokenExpiresAt?: string;
  profile: ConnectedAccountProfile;
  isActive?: boolean;
};

export type ConnectedAccountsResponse = {
  statusCode?: number;
  message?: string;
  data?: Array<{
    _id: string;
    provider: ConnectedAccountProvider;
    accessTokenExpiresAt?: string;
    profileMetadata?: ConnectedAccountProfile;
    isActive?: boolean;
  }>;
};

export type LinkedinAuthUrlResponse = {
  statusCode?: number;
  message?: string;
  data?: string;
};

export type PostMetricsMonthlyItem = {
  count: number;
  month: string;
};

export type PostMetricsResponse = {
  statusCode?: number;
  message?: string;
  data?: {
    total?: number;
    monthly?: PostMetricsMonthlyItem[];
  };
};
