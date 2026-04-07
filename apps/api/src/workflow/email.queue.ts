import { Injectable, OnModuleInit } from '@nestjs/common';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import {
  EMAIL_QUEUE_NAME,
  SCHEDULED_POST_PUBLISHED_EMAIL_JOB_NAME,
  WELCOME_EMAIL_JOB_NAME,
} from './workflow.constants';

@Injectable()
export class EmailQueue implements OnModuleInit {
  private connection: IORedis;
  public queue: Queue;

  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.connection = new IORedis(this.config.get<string>('REDIS_URL')!);
    this.queue = new Queue(EMAIL_QUEUE_NAME, {
      connection: {
        url: this.config.get<string>('REDIS_URL')!,
      },
    });
  }

  async addWelcomeEmailJob(email: string, name: string) {
    await this.queue.add(
      WELCOME_EMAIL_JOB_NAME,
      { email, name },
      {
        jobId: `welcome-email-${email}`,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 10_000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }

  async addScheduledPostPublishedEmailJob(
    email: string,
    name: string,
    postId: string,
  ) {
    await this.queue.add(
      SCHEDULED_POST_PUBLISHED_EMAIL_JOB_NAME,
      { email, name, postId },
      {
        jobId: `scheduled-post-published-${postId}`,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 10_000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }
}
