export enum WorkflowStep {
  EXTRACT_INTENT = 'extractIntent',
  GET_QUERIES = 'getQueries',
  RUN_RESEARCH = 'runResearch',
  CREATE_DRAFT = 'createDraft',
  CREATE_LINKEDIN_DRAFT = 'createLinkedinDraft',
}

export enum ContentType {
  QUICK_POST_LINKEDIN = 'quickPostLinkedin',
  INSIGHT_POST_LINKEDIN = 'insightPostLinkedin',
}

export const QUEUE_NAME = 'workflow';
export const SCHEDULE_QUEUE_NAME = 'post-schedule';
export const LINKEDIN_AVATAR_REFRESH_QUEUE_NAME = 'linkedin-avatar-refresh';
export const LINKEDIN_AVATAR_REFRESH_JOB_NAME = 'refresh-linkedin-avatar';
export const EMAIL_QUEUE_NAME = 'email';
export const WELCOME_EMAIL_JOB_NAME = 'welcome-email';
export const SCHEDULED_POST_PUBLISHED_EMAIL_JOB_NAME =
  'scheduled-post-published-email';
