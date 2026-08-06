import { Job, Worker } from 'bullmq';
import {
  EMAIL_QUEUE_NAME,
  LINKEDIN_AVATAR_REFRESH_QUEUE_NAME,
  MEDIA_UPLOAD_QUEUE_NAME,
  QUEUE_NAME,
  SCHEDULE_QUEUE_NAME,
} from '../workflow.constants';
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { PostService } from '../../post/post.service';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../../database/schemas';
import { AuthService } from '../../auth/auth.service';
import { MailService } from '../../mail';
import { EmailQueue } from '../email.queue';
import { processEmailJob } from './email.worker.handler';
import { ArtifactRunProcessor } from './artifact-run.worker.handler';
import { AgentRunnerService } from '../../agent/agent-runner.service';
import { ArtifactService } from '../../artifact/artifact.service';
import { CarouselRendererService } from '../../carousel';
import { CreditMeterService } from '../../feature-gating/credit-meter.service';
import { FeatureGatingService } from '../../feature-gating/feature-gating.service';
import { RedisService } from '../../redis/redis.service';
import { WorkflowRunService } from '../workflow-run.service';
import { BuildInput } from '../engine/workflow.types';
import { LinkedinMediaService } from '../../post/linkedin-media.service';
import { MediaUploadJobData } from '../media-upload.queue';
import {
  handleMediaUploadJobExhausted,
  processMediaUploadJob,
} from './media-upload.worker.handler';

async function bootstrapWorker() {
  const logger = new Logger(
    bootstrapWorker.name.charAt(0).toUpperCase() +
      bootstrapWorker.name.slice(1),
  );
  logger.log('Bootstrapping workflow context...');
  const app = await NestFactory.createApplicationContext(AppModule);

  const postService = app.get(PostService);
  const authService = app.get(AuthService);
  const mailService = app.get(MailService);
  const emailQueue = app.get(EmailQueue);
  const userModel = app.get<Model<User>>(getModelToken(User.name));
  const linkedinMediaService = app.get(LinkedinMediaService);

  logger.log('NestJs context ready');

  // Every `StepContext` role, resolved once. `RunEventEmitter` and
  // `RunCreditMeter` are per-run, so the processor builds those itself.
  const artifactRuns = new ArtifactRunProcessor({
    agent: app.get(AgentRunnerService),
    artifacts: app.get(ArtifactService),
    renderer: app.get(CarouselRendererService),
    creditMeter: app.get(CreditMeterService),
    featureGating: app.get(FeatureGatingService),
    runs: app.get(WorkflowRunService),
    redis: app.get(RedisService).getClient(),
    logger,
  });

  const workflowWorker = new Worker(
    QUEUE_NAME,
    (job: Job<BuildInput>) => artifactRuns.process(job),
    {
      connection: {
        url: process.env.REDIS_URL!,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      },
    },
  );

  // Fires on every failed attempt; the processor decides which one ends the run.
  workflowWorker.on('failed', (job, error) => {
    if (!job) return;
    artifactRuns.onFailed(job, error).catch((err) => logger.error(err));
  });

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

        await postService.publishPost(postId);
        try {
          await emailQueue.addScheduledPostPublishedEmailJob(
            user.email,
            user.name,
            postId,
          );
        } catch (error) {
          logger.warn(
            `Failed to enqueue scheduled post published email for post ${postId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
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
      try {
        const connectedAccountId = job.data?.connectedAccountId;
        if (!connectedAccountId) {
          logger.warn(
            `Skipping avatar refresh job ${job.id}; missing account id`,
          );
          return;
        }

        logger.log(
          `Processing LinkedIn avatar refresh for ${connectedAccountId}`,
        );
        await authService.refreshLinkedinAvatarForAccount(connectedAccountId);
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
    EMAIL_QUEUE_NAME,
    async (job: Job) => {
      try {
        await processEmailJob(job, logger, mailService);
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

  const mediaUploadWorker = new Worker(
    MEDIA_UPLOAD_QUEUE_NAME,
    async (job: Job<MediaUploadJobData>) => {
      try {
        await processMediaUploadJob(job, logger, linkedinMediaService);
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

  mediaUploadWorker.on('failed', (job, error) => {
    if (!job) return;
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
      handleMediaUploadJobExhausted(job, logger, linkedinMediaService).catch(
        (failure) => logger.error(failure),
      );
      return;
    }
    logger.warn(
      `Media upload job ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts ?? 1}): ${error.message}`,
    );
  });
}
bootstrapWorker();
