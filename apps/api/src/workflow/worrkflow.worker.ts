import { Job, Worker } from 'bullmq';
import { QUEUE_NAME, WorkflowStep } from './workflow.constants';
import { IJobData } from './workflow.interface';
import IORedis from 'ioredis';
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AgentService } from '../agent/agent.service';

async function bootstrapWorker() {
  const logger = new Logger(
    bootstrapWorker.name.charAt(0).toUpperCase() +
      bootstrapWorker.name.slice(1),
  );
  logger.log('Bootstrapping workflow context...');

  const app = await NestFactory.createApplicationContext(AppModule);

  const agentService = app.get(AgentService);

  logger.log('NestJs context ready]');

  const connection = new IORedis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      logger.log(`Processing job ${job.id}`);
      const { steps, input } = job.data as IJobData;

      let stepInput = input;
      let stepOutput: unknown = null;

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        logger.log(`Running step ${step}`);

        await job.updateProgress(((i + 1) / steps.length) * 100);
        await job.updateData({ currentStep: step });

        switch (step) {
          case WorkflowStep.GET_QUERIES:
            stepOutput = await agentService.generateSearchKeywords(
              stepInput as string,
            );
            break;

          case WorkflowStep.RUN_RESEARCH:
            stepOutput = await agentService.research(stepInput as string[]);
            break;

          case WorkflowStep.CREATE_DRAFT:
            stepOutput = await agentService.createDraft(stepInput as string[]);
            break;

          default:
            logger.warn(`Unknown step ${step}`);
        }

        stepInput = stepOutput;
      }

      logger.log(`Job ${job.id} completed`);
      return { success: true, result: stepOutput };
    },
    {
      connection,
    },
  );
}
bootstrapWorker();