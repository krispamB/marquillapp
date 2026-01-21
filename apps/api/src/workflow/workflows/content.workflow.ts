import { WorkflowDefinition } from '../engine/workflow.types';
import { WorkflowStep } from '../workflow.constants';

export const ContentWorkflow: WorkflowDefinition = {
  name: 'content',
  steps: [
    WorkflowStep.EXTRACT_INTENT,
    WorkflowStep.GET_QUERIES,
    WorkflowStep.RUN_RESEARCH,
    WorkflowStep.CREATE_DRAFT,
  ],
};