import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { MailService } from '../../mail';
import {
  SCHEDULED_POST_PUBLISHED_EMAIL_JOB_NAME,
  WELCOME_EMAIL_JOB_NAME,
} from '../workflow.constants';

interface WelcomeEmailJobData {
  email?: string;
  name?: string;
}

interface ScheduledPostPublishedEmailJobData {
  email?: string;
  name?: string;
  postId?: string;
}

async function processWelcomeEmailJob(
  job: Job,
  logger: Logger,
  mailService: MailService,
) {
  const { email, name } = (job.data ?? {}) as WelcomeEmailJobData;
  if (!email || !name) {
    logger.warn(`Skipping welcome email job ${job.id}; missing email or name`);
    return;
  }

  await mailService.sendTemplate({
    to: email,
    template: 'welcome',
    data: {
      name,
      appName: 'Marquill',
    },
  });
}

async function processScheduledPostPublishedEmailJob(
  job: Job,
  logger: Logger,
  mailService: MailService,
) {
  const { email, name, postId } =
    (job.data ?? {}) as ScheduledPostPublishedEmailJobData;
  if (!email || !name || !postId) {
    logger.warn(
      `Skipping scheduled post published email job ${job.id}; missing email, name or postId`,
    );
    return;
  }

  await mailService.sendTemplate({
    to: email,
    template: 'scheduledPostPublished',
    data: {
      name,
      postId,
    },
  });
}

export async function processEmailJob(
  job: Job,
  logger: Logger,
  mailService: MailService,
) {
  logger.log(`Processing ${job.name}`);

  if (job.name === WELCOME_EMAIL_JOB_NAME) {
    await processWelcomeEmailJob(job, logger, mailService);
    return;
  }

  if (job.name === SCHEDULED_POST_PUBLISHED_EMAIL_JOB_NAME) {
    await processScheduledPostPublishedEmailJob(job, logger, mailService);
    return;
  }

  logger.warn(`Skipping unknown email job ${job.id}; name=${job.name}`);
}
