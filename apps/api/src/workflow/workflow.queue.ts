import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { QUEUE_NAME } from './workflow.constants';
import type { BuildInput } from './engine/workflow.types';

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

  /**
   * Kick off an artifact generation run. `jobId` is the `WorkflowRun._id` — the
   * one identity across run, job, and Redis stream — so the SSE endpoint can
   * relay events keyed by the same id the 202 handed the client. `attempts: 3`
   * with exponential backoff is the engine's retry budget: transient step
   * failures ride it, terminal ones raise `UnrecoverableError` to stop early.
   * `removeOnFail: false` keeps the failed job for the terminal-failure handler.
   */
  async addArtifactRunJob(runId: string, input: BuildInput) {
    await this.queue.add(`artifact:${input.type}`, input, {
      jobId: runId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true,
      removeOnFail: false,
    });
  }
}
