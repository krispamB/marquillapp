import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import {
  LINKEDIN_AVATAR_REFRESH_JOB_NAME,
  LINKEDIN_AVATAR_REFRESH_QUEUE_NAME,
} from './workflow.constants';

@Injectable()
export class LinkedinAvatarRefreshQueue implements OnModuleInit, OnModuleDestroy {
  public queue: Queue;
  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.queue = new Queue(LINKEDIN_AVATAR_REFRESH_QUEUE_NAME, {
      connection: {
        url: this.config.get<string>('REDIS_URL')!,
      },
    });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }

  async addAvatarRefreshJob(connectedAccountId: string) {
    await this.queue.add(
      LINKEDIN_AVATAR_REFRESH_JOB_NAME,
      { connectedAccountId },
      {
        jobId: `linkedin-avatar-refresh-${connectedAccountId}`,
        attempts: 5,
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
