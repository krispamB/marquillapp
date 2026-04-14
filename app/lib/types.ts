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
  id?: string;
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

export type ConnectedAccountType = "PERSONAL" | "ORGANIZATION";

export type ConnectedAccountProfile = {
  name?: string;
  email?: string;
  picture?: string;
  sub?: string;
  memberId?: string;
  localizedFirstName?: string;
  localizedLastName?: string;
  localizedHeadline?: string;
  displayImageUrn?: string;
  vanityName?: string;
};

export type ConnectedAccount = {
  id: string;
  provider: ConnectedAccountProvider;
  accountType?: ConnectedAccountType;
  accessTokenExpiresAt?: string;
  displayName?: string;
  avatarUrl?: string;
  vanityName?: string;
  headline?: string;
  profile?: ConnectedAccountProfile;
  isActive?: boolean;
};

export type ConnectedAccountsResponse = {
  statusCode?: number;
  message?: string;
  data?: Array<{
    _id: string;
    provider: ConnectedAccountProvider;
    accessTokenExpiresAt?: string;
    displayName?: string;
    avatarUrl?: string;
    vanityName?: string;
    profileMetadata?: ConnectedAccountProfile;
    isActive?: boolean;
  }>;
};

export type LinkedinAuthUrlResponse = {
  statusCode?: number;
  message?: string;
  data?: string;
};

export type PaymentUsageMetric = {
  used: number;
  limit: number;
  remaining: number;
};

export type PaymentUsageData = {
  tier: {
    id: string;
    name: string;
  };
  billingCycle: {
    start: string;
    end: string;
    source: string;
  };
  usage: Record<string, PaymentUsageMetric>;
};

export type PaymentUsageResponse = {
  statusCode?: number;
  message?: string;
  data?: PaymentUsageData;
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

export type DashboardPost = {
  _id: string;
  connectedAccount?: string;
  status?: string;
  type?: "quickPostLinkedin" | "insightPostLinkedin" | string;
  content?: string;
  youtubeResearch?: Array<{
    videoId?: string;
    title?: string;
    thumbnail?: string;
    channelTitle?: string;
    publishedAt?: string;
  }>;
  scheduledAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type DashboardPostsResponse = {
  statusCode?: number;
  message?: string;
  data?: DashboardPost[];
  filters?: {
    availableMonths?: string[];
    connectedAccountIds?: string[];
  };
};

export type PostStatus = "DRAFT" | "SCHEDULED" | "PUBLISHED";

export enum StylePreset {
  PROFESSIONAL = 'professional',
  STORYTELLING = 'storytelling',
  EDUCATIONAL = 'educational',
  BOLD = 'bold',
  CONTRARIAN = 'contrarian',
  FOUNDER = 'founder',
}

export type CreateDraftRequest = {
  input: string;
  contentType: "quickPostLinkedin" | "insightPostLinkedin";
  stylePreset: StylePreset;
};

export type CreateDraftResponse = {
  statusCode?: number;
  message?: string;
  data?: string;
};

export type DraftStatusProgress = {
  percentage?: number;
  currentStep?: string;
};

export type DraftStatusData = {
  state?: string;
  progress?: DraftStatusProgress;
  status?: string;
};

export type DraftStatusResponse = {
  statusCode?: number;
  message?: string;
  data?: DraftStatusData;
};

export type FeatureLimitErrorResponse = {
  code: "FEATURE_LIMIT_EXCEEDED";
  feature: string;
  limit: number;
  currentUsage: number;
  tier: {
    id: string;
    name: string;
  };
  upgradeHint: string;
};

export class FeatureLimitExceededError extends Error {
  public feature: string;
  public limit: number;
  public currentUsage: number;
  public tier: { id: string; name: string };
  public upgradeHint: string;

  constructor(response: FeatureLimitErrorResponse) {
    super(response.upgradeHint);
    this.name = "FeatureLimitExceededError";
    this.feature = response.feature;
    this.limit = response.limit;
    this.currentUsage = response.currentUsage;
    this.tier = response.tier;
    this.upgradeHint = response.upgradeHint;
  }
}

export type PostDetailData = {
  _id?: string;
  type?: string;
  status?: string;
  content?: string;
  media?: PostMediaItem[];
  createdAt?: string;
  updatedAt?: string;
};

export type PostDetailResponse = {
  statusCode?: number;
  message?: string;
  data?: PostDetailData;
};

export type UpdatePostResponse = {
  statusCode?: number;
  message?: string;
  data?: PostDetailData;
};

export type PublishPostResponse = {
  statusCode?: number;
  message?: string;
};

export type SchedulePostResponse = {
  statusCode?: number;
  message?: string;
  data?: PostDetailData;
};

export type ImageUploadResponse = {
  statusCode?: number;
  message?: string;
};

export type PostMediaItem = {
  id?: string;
  title?: string;
  altText?: string;
  _id?: string;
};

export type LinkedinImageDetailsData = {
  downloadUrl?: string;
  downloadUrlExpiresAt?: number;
};

export type LinkedinImageDetailsResponse = {
  statusCode?: number;
  message?: string;
  data?: LinkedinImageDetailsData;
};

// ─── LinkedIn Organization / Company Page ────────────────────────────────────

export type LinkedInOrg = {
  id: string;
  urn: string;
  name: string;
  logoUrl: string | null;
  role: string;
  state: string;
};

export type ListOrgsResponse = {
  statusCode?: number;
  message?: string;
  data?: LinkedInOrg[];
};

export type ConnectOrgsResponse = {
  statusCode?: number;
  message?: string;
  data?: ConnectedAccount[];
};

export type DisconnectAccountResponse = {
  statusCode?: number;
  message?: string;
  data?: {
    accountId: string;
    deactivatedCount: number;
    scheduledPostsCanceled: number;
  };
};
