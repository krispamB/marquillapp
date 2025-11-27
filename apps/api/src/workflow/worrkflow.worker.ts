import { Worker, Job } from 'bullmq';
import { QUEUE_NAME, WORKFLOW_STEPS } from './workflow.constants';
import { IJobData } from './workflow.interface';
import IORedis from 'ioredis';
import 'dotenv/config';

export const createWorkflowWorker = () => {
  const connection = new IORedis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  return new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      const { steps, input } = job.data as IJobData;

      let stepInput = input;
      let stepOutput: unknown = null;

      for (let i = 0; i < steps.length; i++) {
        const stepName = steps[i];
        await job.updateProgress(((i + 1) / steps.length) * 100);

        if (stepName === WORKFLOW_STEPS.GET_QUERIES) {
          setTimeout(() => {
            console.log('getting queries...', stepInput);
          }, 30000);
          stepOutput = 'running';
        }

        if (stepName === WORKFLOW_STEPS.RUN_RESEARCH) {
          setTimeout(() => {
            console.log('Running research...', stepInput);
          }, 20000);
          stepOutput = 'researching';
        }

        if (stepName === WORKFLOW_STEPS.CREATE_DRAFT) {
          setTimeout(() => {
            console.log('Creating Draft...', stepInput);
          }, 20000);
          stepOutput = 'drafting';
        }

        stepInput = stepOutput;
      }

      return { success: true, result: stepOutput };
    },
    {
      connection,
    },
  );
};

createWorkflowWorker();
