export enum WorkflowStep {
  EXTRACT_INTENT = 'extractIntent',
  GET_QUERIES = 'getQueries',
  RUN_RESEARCH = 'runResearch',
  CREATE_DRAFT = 'createDraft',
}

export const QUEUE_NAME = 'workflow';
