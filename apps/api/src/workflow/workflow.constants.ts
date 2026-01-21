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
