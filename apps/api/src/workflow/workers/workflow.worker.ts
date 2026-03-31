import { Job, Worker } from 'bullmq';
import {
  LINKEDIN_AVATAR_REFRESH_QUEUE_NAME,
  QUEUE_NAME,
  SCHEDULE_QUEUE_NAME,
} from '../workflow.constants';
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { AgentService } from '../../agent/agent.service';
import { PostService } from '../../post/post.service';
import { WorkflowRegistry } from '../engine/workflow.registory';
import { runWorkflow } from '../engine/workflow.engine';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../../database/schemas';
import { AuthService } from '../../auth/auth.service';

async function bootstrapWorker() {
  const logger = new Logger(
    bootstrapWorker.name.charAt(0).toUpperCase() +
      bootstrapWorker.name.slice(1),
  );
  logger.log('Bootstrapping workflow context...');
  const app = await NestFactory.createApplicationContext(AppModule);

  const agentService = app.get(AgentService);
  const postService = app.get(PostService);
  const authService = app.get(AuthService);
  const userModel = app.get<Model<User>>(getModelToken(User.name));

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

  new Worker(
    SCHEDULE_QUEUE_NAME,
    async (job: Job) => {
      try {
        const { postId, userId } = job.data;
        const user = await userModel.findById(userId);
        if (!user) {
          logger.error(`User not found for schedule job ${job.id}`);
          return;
        }

        await postService.publishOnLinkedIn(user, postId);
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

  new Worker(
    LINKEDIN_AVATAR_REFRESH_QUEUE_NAME,
    async (job: Job) => {
      const connectedAccountId = job.data?.connectedAccountId;
      if (!connectedAccountId) {
        logger.warn(`Skipping avatar refresh job ${job.id}; missing account id`);
        return;
      }

      logger.log(`Processing LinkedIn avatar refresh for ${connectedAccountId}`);
      await authService.refreshLinkedinAvatarForAccount(connectedAccountId);
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
