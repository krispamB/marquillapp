import { Job, Worker } from 'bullmq';
import { QUEUE_NAME, WorkflowStep } from '../workflow.constants';
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { AgentService } from '../../agent/agent.service';
import { WorkflowRegistry } from '../engine/workflow.registory';
import { runWorkflow } from '../engine/workflow.engine';

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
      const workflow = WorkflowRegistry[job.name];
      if (!workflow) {
        throw new Error(`Unknown workflow: ${job.name}`);
      }

      try {
        return runWorkflow(workflow, job, {
          logger,
          agentService,
        });
      } catch (error) {
        logger.error(error);
        throw error;
      }




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
