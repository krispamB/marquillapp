import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { SCHEDULE_QUEUE_NAME } from './workflow.constants';

@Injectable()
export class ScheduleQueue implements OnModuleInit, OnModuleDestroy {
  public queue: Queue;
  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.queue = new Queue(SCHEDULE_QUEUE_NAME, {
      connection: {
        url: this.config.get<string>('REDIS_URL')!,
      },
    });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }

  async addScheduleJob(postId: string, userId: string, delay: number) {
    await this.queue.add(
      'publish',
      { postId, userId },
      {
        jobId: postId,
        delay,
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }
}
