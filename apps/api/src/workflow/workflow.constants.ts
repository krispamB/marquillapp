export enum WorkflowStep {
  RESOLVE_INPUT = 'RESOLVE_INPUT',
  RESEARCH = 'RESEARCH',
  GENERATE = 'GENERATE',
  RENDER_PDF = 'RENDER_PDF',
  PERSIST_VERSION = 'PERSIST_VERSION',
}

export const QUEUE_NAME = 'workflow';
export const SCHEDULE_QUEUE_NAME = 'post-schedule';
export const LINKEDIN_AVATAR_REFRESH_QUEUE_NAME = 'linkedin-avatar-refresh';
export const LINKEDIN_AVATAR_REFRESH_JOB_NAME = 'refresh-linkedin-avatar';
export const EMAIL_QUEUE_NAME = 'email';
export const MEDIA_UPLOAD_QUEUE_NAME = 'media-upload';
export const MEDIA_UPLOAD_JOB_NAME = 'upload-post-media';
export const WELCOME_EMAIL_JOB_NAME = 'welcome-email';
export const SCHEDULED_POST_PUBLISHED_EMAIL_JOB_NAME =
  'scheduled-post-published-email';

/**
 * Repair turns per job attempt (document generation spec §7.2), shared by
 * static and render Repairs. For DOCUMENT, a Zod repair turn spends one too.
 * A module constant, so a document never generates differently per
 * environment.
 */
export const DOCUMENT_REPAIR_BUDGET = 2;

/**
 * The stable code `run.failed` carries beside `failureReason`, and that a failed
 * Attempt stores (document generation spec §7.8). POST and POLL emit only
 * `internal`; the DOCUMENT codes arrive with the document pipeline.
 */
export enum FailureCode {
  DOCUMENT_REPAIR_EXHAUSTED = 'document.repair_exhausted',
  DOCUMENT_TRUNCATED = 'document.truncated',
  DESIGN_SYSTEM_UNAVAILABLE = 'design_system.unavailable',
  RENDER_UNAVAILABLE = 'render.unavailable',
  ARTIFACT_SOURCE_MISSING = 'artifact.source_missing',
  INTERNAL = 'internal',
}

/**
 * The client-facing `failureReason` for each code a DOCUMENT run fails with
 * (spec §7.8). `internal` has none here: its reason is the existing
 * terminal-or-temporary wording, so POST and POLL read exactly as before.
 */
export const FAILURE_REASONS: Partial<Record<FailureCode, string>> = {
  [FailureCode.DOCUMENT_REPAIR_EXHAUSTED]:
    "We couldn't get this design to fit cleanly. Try refining with a shorter brief or another design.",
  [FailureCode.DOCUMENT_TRUNCATED]:
    'This document was too long to generate. Try fewer pages or a shorter brief.',
  [FailureCode.DESIGN_SYSTEM_UNAVAILABLE]:
    'This design is unavailable. Try again with another design.',
  [FailureCode.RENDER_UNAVAILABLE]:
    "We couldn't render your document right now. Please try again.",
  [FailureCode.ARTIFACT_SOURCE_MISSING]:
    "This version can't be refined. Refine the current version again or create a new document.",
};
