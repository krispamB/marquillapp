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
