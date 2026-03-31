import { Injectable, OnModuleInit } from '@nestjs/common';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import {
  LINKEDIN_AVATAR_REFRESH_JOB_NAME,
  LINKEDIN_AVATAR_REFRESH_QUEUE_NAME,
} from './workflow.constants';

@Injectable()
export class LinkedinAvatarRefreshQueue implements OnModuleInit {
  private connection: IORedis;
  public queue: Queue;
  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.connection = new IORedis(this.config.get<string>('REDIS_URL')!);
    this.queue = new Queue(LINKEDIN_AVATAR_REFRESH_QUEUE_NAME, {
      connection: {
        url: this.config.get<string>('REDIS_URL')!,
      },
    });
  }

  async addAvatarRefreshJob(connectedAccountId: string) {
    await this.queue.add(
      LINKEDIN_AVATAR_REFRESH_JOB_NAME,
      { connectedAccountId },
      {
        jobId: `linkedin-avatar-refresh:${connectedAccountId}`,
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
