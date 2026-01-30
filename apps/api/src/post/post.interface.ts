export interface ILinkedInPost {
    author: string;
    commentary: string;
    content?: any;
    visibility: 'PUBLIC' | 'CONNECTIONS';
    distribution: {
        feedDistribution: 'MAIN_FEED';
        targetEntities: any[];
        thirdPartyDistributionChannels: any[];
    };
    lifecycleState: 'PUBLISHED' | 'DRAFT';
    isReshareDisabledByAuthor: boolean;
}

export interface IShareContent {
    shareCommentary: string;
    shareMediaCategory: "NONE" | "ARTICLE" | "IMAGE";
    media?: IShareMedia[];
}

export interface IShareMedia {
    status: string; // READY
    description?: string;
    media?: string //DigitalMediaAsset URN
    originalUrl?: string
    title?: string
}