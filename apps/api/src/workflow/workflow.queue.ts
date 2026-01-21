import { Injectable, OnModuleInit } from '@nestjs/common';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { QUEUE_NAME } from './workflow.constants';
import { IJobData } from './workflow.interface';

@Injectable()
export class WorkflowQueue implements OnModuleInit {
  private connection: IORedis;
  public queue: Queue;
  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.connection = new IORedis(this.config.get<string>('REDIS_URL')!);
    this.queue = new Queue(QUEUE_NAME, {
      connection: {
        url: this.config.get<string>('REDIS_URL')!,
      },
    });
  }

  async addWorkflowJob(workflowId: string, payload: IJobData) {
    await this.queue.add(payload.workflowName, payload.input, {
      jobId: workflowId,
      removeOnComplete: false,
      removeOnFail: false,
    });
  }
}
