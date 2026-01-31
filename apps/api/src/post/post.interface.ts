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
    };
    multiImage?: any
}

export interface IShareMedia {
    status: string; // READY
    description?: string;
    media?: string //DigitalMediaAsset URN
    originalUrl?: string
    title?: string
}