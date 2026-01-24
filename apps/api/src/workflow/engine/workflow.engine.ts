import { Job } from 'bullmq';
import { WorkflowContext, WorkflowDefinition } from './workflow.types';
import { WorkflowStep } from '../workflow.constants';
import {
  createDraftStep,
  createLinkedinDraftStep,
  extractIntentStep,
  getQueriesStep,
  runReasearchStep,
} from '../steps';

const stepHandlers = {
  [WorkflowStep.EXTRACT_INTENT]: extractIntentStep,
  [WorkflowStep.GET_QUERIES]: getQueriesStep,
  [WorkflowStep.RUN_RESEARCH]: runReasearchStep,
  [WorkflowStep.CREATE_DRAFT]: createDraftStep,
  [WorkflowStep.CREATE_LINKEDIN_DRAFT]: createLinkedinDraftStep,
};

export async function runWorkflow(
  workflow: WorkflowDefinition,
  job: Job,
  ctx: WorkflowContext,
) {
  ctx.logger.log(`Starting workflow: ${workflow.name}`);

  let state = {
    data: job.data,
    initialInput: job.data,
    metadata: {},
  };

  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i];

    ctx.logger.log(`Executing step: ${step}`);
    await job.updateProgress(((i + 1) / workflow.steps.length) * 100);

    const handler = stepHandlers[step];
    if (!handler) {
      throw new Error(`No handler for step ${step}`);
    }

    state = await handler(state, job, ctx);
  }

  return state;
}
