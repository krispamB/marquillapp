export type ArtifactType = "POST" | "POLL" | "DOCUMENT";

export type ArtifactStatus = "GENERATING" | "READY" | "FAILED";

export type WorkflowStep =
  | "RESOLVE_INPUT"
  | "RESEARCH"
  | "GENERATE"
  | "RENDER_PDF"
  | "PERSIST_VERSION";

export type ArtifactRunKind = "INITIAL" | "REFINE";

export type ArtifactVersionSummary = {
  version: number;
  status: ArtifactStatus;
  createdAt?: string;
  editedAt?: string;
  refineFeedback?: string;
};

export type CreateArtifactResponse = {
  artifactId: string;
  runId: string;
};

export type RefineArtifactResponse = CreateArtifactResponse & {
  version: number;
};

export type RunStartedEvent = {
  seq: number;
  ts: number;
  kind: ArtifactRunKind;
  type: ArtifactType;
  steps: WorkflowStep[];
};

export type RunStepEvent = {
  seq: number;
  ts: number;
  step: WorkflowStep;
  index: number;
  total: number;
};

export type RunProgressEvent = {
  seq: number;
  ts: number;
  step: WorkflowStep;
  sourcesFound?: number;
};

export type RunUsageEvent = {
  seq: number;
  ts: number;
  kind: "llm" | "web_search" | "pdf_render";
  credits: number;
  totalCredits: number;
  detail?: unknown;
};

export type RunStepFailedEvent = {
  seq: number;
  ts: number;
  step: WorkflowStep;
  retryable: boolean;
  message: string;
};

export type RunCompletedEvent = {
  seq: number;
  ts: number;
  artifactId: string;
  version: number;
};

export type RunFailedEvent = {
  seq: number;
  ts: number;
  failureReason: string;
};

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
  versions?: ArtifactVersionSummary[];
};

export type ArtifactDetailResponse = {
  statusCode?: number;
  message?: string;
  data?: ArtifactDetailData;
};
