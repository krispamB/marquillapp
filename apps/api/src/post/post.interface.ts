export interface ILinkedInPost {
  author: string;
  commentary?: string;
  content?: IContent;
  visibility: 'PUBLIC' | 'CONNECTIONS';
  distribution: {
    feedDistribution: 'MAIN_FEED';
    targetEntities: any[];
    thirdPartyDistributionChannels: any[];
  };
  lifecycleState: 'PUBLISHED' | 'DRAFT';
  isReshareDisabledByAuthor: boolean;
}

export interface IContent {
  media?: {
    title?: string;
    id: string;
    altText?: string;
  };
  multiImage?: {
    images: { id: string; altText?: string }[];
  };
}

export interface IVideoInitResponse {
  value: {
    video: string;
    uploadToken: string;
    uploadUrlsExpireAt: number;
    uploadInstructions: {
      uploadUrl: string;
      firstByte: number;
      lastByte: number;
    }[];
  };
}
