import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { QUEUE_NAME } from './workflow.constants';
import { IJobData } from './workflow.interface';

@Injectable()
export class WorkflowQueue implements OnModuleInit, OnModuleDestroy {
  public queue: Queue;
  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.queue = new Queue(QUEUE_NAME, {
      connection: {
        url: this.config.get<string>('REDIS_URL')!,
      },
    });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }

  async addWorkflowJob(workflowId: string, payload: IJobData) {
    await this.queue.add(payload.workflowName, payload.input, {
      jobId: workflowId,
      removeOnComplete: true,
      removeOnFail: false,
    });
  }
}
