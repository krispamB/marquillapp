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
