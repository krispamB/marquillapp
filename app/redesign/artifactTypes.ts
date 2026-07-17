export type ArtifactType = "POST" | "POLL" | "DOCUMENT";

export type ArtifactStatus = "GENERATING" | "READY" | "FAILED";

export type ArtifactSlide =
  | { type: "cover"; fields: { eyebrow?: string; title: string; subtitle?: string } }
  | { type: "content"; fields: { heading: string; body: string } }
  | { type: "list"; fields: { heading: string; items: string[] } }
  | { type: "quote"; fields: { quote: string; attribution?: string } }
  | { type: "cta"; fields: { headline: string; action: string; handle?: string } };

export type ArtifactSummary = {
  id: string;
  type: ArtifactType;
  title?: string;
  status: ArtifactStatus;
  updatedAt?: string;
  preview?: {
    commentary?: string;
    firstSlide?: ArtifactSlide;
    pdfUrl?: string;
  };
};

export type ArtifactsListResponse = {
  statusCode?: number;
  message?: string;
  data?: ArtifactSummary[];
  filters?: {
    availableMonths?: string[];
    types?: ArtifactType[];
  };
  page?: number;
  pages?: number;
};

export type ArtifactDetailData = {
  id: string;
  type: ArtifactType;
  title?: string;
  currentVersion: number;
  version: number;
  status: ArtifactStatus;
  updatedAt?: string;
  content: {
    commentary?: string;
    poll?: {
      question: string;
      options: string[];
      durationDays: 1 | 3 | 7 | 14;
    };
    document?: {
      templateId: "bold" | "minimal" | "editorial" | "gradient";
      slides: ArtifactSlide[];
      pageCount?: number;
      pdfUrl?: string;
    };
  };
};

export type ArtifactDetailResponse = {
  statusCode?: number;
  message?: string;
  data?: ArtifactDetailData;
};
