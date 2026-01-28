import { WorkflowDefinition } from '../engine/workflow.types';
import { WorkflowStep } from '../workflow.constants';

export const InsightPostLinkedinWorkflow: WorkflowDefinition = {
  name: 'insightPostLinkedin',
  steps: [
    WorkflowStep.EXTRACT_INTENT,
    WorkflowStep.GET_QUERIES,
    WorkflowStep.RUN_RESEARCH,
    WorkflowStep.CREATE_LINKEDIN_DRAFT,
  ],
};
