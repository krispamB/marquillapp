import { WorkflowDefinition } from '../engine/workflow.types';
import { WorkflowStep } from '../workflow.constants';

export const QuickPostLinkedinWorkflow: WorkflowDefinition = {
  name: 'quickpostlinkedin',
  steps: [WorkflowStep.EXTRACT_INTENT, WorkflowStep.CREATE_LINKEDIN_DRAFT],
};
