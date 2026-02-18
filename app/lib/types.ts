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

export type DashboardPost = {
  _id: string;
  connectedAccount?: string;
  status?: string;
  content?: string;
  scheduledAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type DashboardPostsResponse = {
  statusCode?: number;
  message?: string;
  data?: DashboardPost[];
};

export type PostStatus = "DRAFT" | "SCHEDULED" | "PUBLISHED";

export type CreateDraftRequest = {
  input: string;
  contentType: "quickPostLinkedin" | "insightPostLinkedin";
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
