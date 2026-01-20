import { Job, Worker } from 'bullmq';
import { QUEUE_NAME, WorkflowStep } from './workflow.constants';
import { IJobData } from './workflow.interface';
import IORedis from 'ioredis';
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AgentService } from '../agent/agent.service';
import { CompressionResult, UserIntent } from '../agent/agent.interface';

async function bootstrapWorker() {
  const logger = new Logger(
    bootstrapWorker.name.charAt(0).toUpperCase() +
      bootstrapWorker.name.slice(1),
  );
  logger.log('Bootstrapping workflow context...');

  const app = await NestFactory.createApplicationContext(AppModule);

  const agentService = app.get(AgentService);

  logger.log('NestJs context ready');

  new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      logger.log(`Processing job ${job.id}`);
      const { steps, input } = job.data as IJobData;

      const userIntent = input as UserIntent;
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
              stepInput as UserIntent,
            );
            break;

          case WorkflowStep.RUN_RESEARCH:
            {
              const transcripts = await agentService.getYouTubeTranscripts(
                stepInput as string[],
              );

              stepOutput = await agentService.extractInsight(
                transcripts,
                userIntent,
              );
            }
            break;

          case WorkflowStep.CREATE_DRAFT:
            stepOutput = await agentService.createDraft(
              stepOutput as CompressionResult,
              userIntent,
            );
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
      connection: {
        url: process.env.REDIS_URL!,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      },
    },
  );
}
bootstrapWorker();
