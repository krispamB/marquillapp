import { WorkflowStep } from './workflow.constants';

export interface IJobData {
  steps: Array<WorkflowStep>;
  input: unknown;
}
