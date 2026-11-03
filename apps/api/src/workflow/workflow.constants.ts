// Type-only: artifact.schema imports FailureCode from here.
import type { ArtifactType } from '../database/schemas/artifact.schema';

export enum WorkflowStep {
  RESOLVE_INPUT = 'RESOLVE_INPUT',
  RESEARCH = 'RESEARCH',
  GENERATE = 'GENERATE',
  RENDER_PDF = 'RENDER_PDF',
  PERSIST_VERSION = 'PERSIST_VERSION',
}

/** POST and POLL runs, and DOCUMENT jobs enqueued before the split. */
export const QUEUE_NAME = 'workflow';
/** DOCUMENT runs, on their own queue so a burst of documents can't hold up text runs. */
export const DOCUMENT_QUEUE_NAME = 'workflow-document';
export type WorkflowQueueName = typeof QUEUE_NAME | typeof DOCUMENT_QUEUE_NAME;

/** The queue an artifact run of `type` is enqueued on. */
export const queueNameFor = (type: ArtifactType): WorkflowQueueName =>
  (type as string) === 'DOCUMENT' ? DOCUMENT_QUEUE_NAME : QUEUE_NAME;

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

/** What a Repair answers with (spec §7.2): the whole document, or edits to it. */
export type DocumentRepairMode = 'full' | 'patch';

/**
 * Deploy-switched, like every module constant here (spec §10): `full` asks a
 * Repair for the complete Candidate Source, `patch` for edits, with one
 * `{ html }` fallback per job attempt when they do not apply. Go/no-go for
 * `patch` is an eval fallback rate under 20%.
 */
export const DOCUMENT_REPAIR_MODE: DocumentRepairMode = 'full';

/**
 * `patch`-mode fallbacks per job attempt: warm `{ html }` follow-ups after
 * edits that did not apply. Billed, but not turns of `DOCUMENT_REPAIR_BUDGET`.
 */
export const DOCUMENT_REPAIR_FALLBACKS = 1;

/**
 * The wall-clock bound on one DOCUMENT job attempt (spec §7.5), checked before
 * each model call and render session.
 */
export const DOCUMENT_RUN_DEADLINE_MS = 6 * 60 * 1000;

/**
 * The pause before a render that hit `render.timeout` or
 * `render.fonts.failed` is retried once in-step (spec §7.3).
 */
export const RENDER_RETRY_DELAY_MS = 2000;

/**
 * A render waits for a Browserless slot only while this much of the job
 * attempt would still be left (M4.2): its wait is bounded by
 * `min(BROWSERLESS_SLOT_WAIT_MAX_MS, time left - this)`.
 */
export const RENDER_SLOT_WAIT_RESERVE_MS = 20_000;

/**
 * How long a DOCUMENT run keeps Candidate Source text (spec §11.5): the
 * `acceptedCandidate` checkpoint and a failed run's last candidate. The run
 * record and its check outcomes are kept indefinitely.
 */
export const CANDIDATE_SOURCE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

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
