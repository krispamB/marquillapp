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
