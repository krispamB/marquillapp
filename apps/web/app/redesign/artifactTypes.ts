import type { ArtifactContent, PollDurationDays } from "../lib/artifact-content";
export { POLL_DURATION_DAYS } from "../lib/artifact-content";
export type { ArtifactContent, PollDurationDays } from "../lib/artifact-content";

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
  /** FAILED versions only. */
  failureCode?: RunFailureCode;
  failureReason?: string;
};

/**
 * The newest version when it is not the Current Version: a refine in flight,
 * a refine that failed, or a first version that never became READY.
 */
export type LatestAttempt = {
  version: number;
  status: Exclude<ArtifactStatus, "READY">;
  failureCode?: RunFailureCode;
  failureReason?: string;
  /** Absent only in the instant before the Attempt's run is recorded. */
  runId?: string;
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
  /** RESEARCH. */
  sourcesFound?: number;
  /** DOCUMENT `GENERATE` (`draft`) and `RENDER_PDF` (`render`). */
  phase?: string;
  /** DOCUMENT `RENDER_PDF`: the render session number. */
  session?: number;
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

/** Stable failure codes on `run.failed`; POST and POLL runs only emit `internal`. */
export type RunFailureCode =
  | "document.repair_exhausted"
  | "document.truncated"
  | "design_system.unavailable"
  | "render.unavailable"
  | "artifact.source_missing"
  | "internal";

export type RunFailedEvent = {
  seq: number;
  ts: number;
  code: RunFailureCode;
  failureReason: string;
};

export type ArtifactSummary = {
  id: string;
  type: ArtifactType;
  title?: string;
  /** Derived: GENERATING while an Attempt is in flight, else READY with a Current Version, else FAILED. */
  status: ArtifactStatus;
  currentVersion?: number;
  latestAttempt?: LatestAttempt;
  updatedAt?: string;
  preview?: {
    commentary?: string;
    pdfUrl?: string;
    pageCount?: number;
    /** DOCUMENT only: signed PNG of page 1, absent when the cover capture failed. */
    coverUrl?: string;
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
  /** The newest READY version; absent until the first version is READY. */
  currentVersion?: number;
  latestAttempt?: LatestAttempt;
  /** The returned version: the Current Version unless ?version= asked for another, or there is none. */
  version: number;
  /** The returned version's own status, not the artifact's. */
  status: ArtifactStatus;
  /** FAILED versions only. */
  failureCode?: RunFailureCode;
  failureReason?: string;
  updatedAt?: string;
  /** Empty unless the returned version is READY. */
  content: ArtifactContent;
  versions?: ArtifactVersionSummary[];
};

export type ArtifactDetailResponse = {
  statusCode?: number;
  message?: string;
  data?: ArtifactDetailData;
};

export type UpdateArtifactRequest = {
  title?: string;
  content: {
    commentary?: string;
    poll?: {
      question: string;
      options: string[];
      durationDays: PollDurationDays;
    };
  };
};

export type DeleteArtifactResponse = {
  statusCode?: number;
  message?: string;
  data?: {
    id: string;
    deletedAt: string;
  };
};
