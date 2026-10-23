import { Job, QueueEvents, Worker } from 'bullmq';
import {
  EMAIL_QUEUE_NAME,
  LINKEDIN_AVATAR_REFRESH_QUEUE_NAME,
  DOCUMENT_QUEUE_NAME,
  MEDIA_UPLOAD_QUEUE_NAME,
  QUEUE_NAME,
  SCHEDULE_QUEUE_NAME,
} from '../workflow.constants';
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import { PostService } from '../../post/post.service';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../../database/schemas';
import { AuthService } from '../../auth/auth.service';
import { MailService } from '../../mail';
import { EmailQueue } from '../email.queue';
import { WorkflowQueue } from '../workflow.queue';
import { processEmailJob } from './email.worker.handler';
import { ArtifactRunProcessor } from './artifact-run.worker.handler';
import { AgentRunnerService } from '../../agent/agent-runner.service';
import { ArtifactService } from '../../artifact/artifact.service';
import { DocumentRendererService } from '../../document-render/document-renderer.service';
import { DesignSystemsService } from '../../design-system/design-systems.service';
import { findFile, uploadFile } from '../../s3';
import { CreditMeterService } from '../../feature-gating/credit-meter.service';
import { FeatureGatingService } from '../../feature-gating/feature-gating.service';
import { InflightRunLimiter } from '../inflight-run-limiter';
import { RedisService } from '../../redis/redis.service';
import { WorkflowRunService } from '../workflow-run.service';
import { BuildInput } from '../engine/workflow.types';
import { LinkedinMediaService } from '../../post/linkedin-media.service';
import { MediaUploadJobData } from '../media-upload.queue';
import {
  handleMediaUploadJobExhausted,
  processMediaUploadJob,
} from './media-upload.worker.handler';
import { handleStalledFailure } from './stalled-failure';
import {
  installWorkerShutdown,
  readWorkerShutdownTimeoutMs,
} from './worker-shutdown';
import { workflowWorkerOptions } from './workflow-worker-options';

async function bootstrapWorker() {
  const logger = new Logger(
    bootstrapWorker.name.charAt(0).toUpperCase() +
      bootstrapWorker.name.slice(1),
  );
  // Read before the app boots, so a bad value fails fast.
  const shutdownTimeoutMs = readWorkerShutdownTimeoutMs(process.env);
  const runWorkerOptions = workflowWorkerOptions(process.env);
  logger.log('Bootstrapping workflow context...');
  const app = await NestFactory.createApplicationContext(WorkerModule);

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
    designSystems: app.get(DesignSystemsService),
    renderer: app.get(DocumentRendererService),
    objects: {
      put: async (key, body, contentType) => {
        await uploadFile(key, body, contentType);
      },
      get: findFile,
    },
    creditMeter: app.get(CreditMeterService),
    featureGating: app.get(FeatureGatingService),
    runs: app.get(WorkflowRunService),
    inflight: app.get(InflightRunLimiter),
    redis: app.get(RedisService).getClient(),
    logger,
  });

  // Two workers on the same processor: `workflow` (POST, POLL, and DOCUMENT
  // jobs enqueued before the split; the processor is type-agnostic) and
  // `workflow-document`, each with its own concurrency.
  const workflowQueues = app.get(WorkflowQueue);
  const runConnection = {
    url: process.env.REDIS_URL!,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
  const runWorkers: Worker[] = [];
  const runEvents: QueueEvents[] = [];
  for (const queueName of [QUEUE_NAME, DOCUMENT_QUEUE_NAME] as const) {
    const options = runWorkerOptions[queueName];
    const worker = new Worker(
      queueName,
      (job: Job<BuildInput>) => artifactRuns.process(job),
      { connection: runConnection, ...options },
    );
    logger.log(
      `Worker on ${queueName}: concurrency ${options.concurrency}, lock ${options.lockDuration} ms`,
    );

    // Fires on every failed attempt; the processor decides which one ends the run.
    worker.on('failed', (job, error) => {
      if (!job) return;
      artifactRuns.onFailed(job, error).catch((err) => logger.error(err));
    });

    // Queue-wide: a job that stalled out ends its run even when no worker in
    // this process reports it. `onFailed` ends a run at most once.
    const queue = workflowQueues.queueFor(queueName);
    const events = new QueueEvents(queueName, { connection: runConnection });
    events.on('failed', (event) => {
      handleStalledFailure(event, {
        getJob: (jobId) => queue.getJob(jobId),
        onFailed: (job, error) => artifactRuns.onFailed(job, error),
        logger,
      }).catch((err) => logger.error(err));
    });

    runWorkers.push(worker);
    runEvents.push(events);
  }

  const scheduleWorker = new Worker(
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

  const avatarRefreshWorker = new Worker(
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

  const emailWorker = new Worker(
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

  installWorkerShutdown({
    signals: process,
    closables: [
      ...runWorkers,
      scheduleWorker,
      avatarRefreshWorker,
      emailWorker,
      mediaUploadWorker,
    ],
    listeners: runEvents,
    idle: () => artifactRuns.idle(),
    app,
    exit: (code) => process.exit(code),
    timeoutMs: shutdownTimeoutMs,
    timers: {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
    },
    logger,
  });
}
bootstrapWorker();
