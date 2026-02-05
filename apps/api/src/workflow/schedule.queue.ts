import { Injectable, OnModuleInit } from '@nestjs/common';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { SCHEDULE_QUEUE_NAME } from './workflow.constants';

@Injectable()
export class ScheduleQueue implements OnModuleInit {
  private connection: IORedis;
  public queue: Queue;
  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.connection = new IORedis(this.config.get<string>('REDIS_URL')!);
    this.queue = new Queue(SCHEDULE_QUEUE_NAME, {
      connection: {
        url: this.config.get<string>('REDIS_URL')!,
      },
    });
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
