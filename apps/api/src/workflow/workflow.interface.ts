import { WORKFLOW_STEPS } from './workflow.constants';

export interface IJobData {
  steps: Array<WORKFLOW_STEPS>;
  input: unknown;
}
