import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import {
  DOCUMENT_QUEUE_NAME,
  QUEUE_NAME,
  queueNameFor,
  type WorkflowQueueName,
} from './workflow.constants';
import type { BuildInput } from './engine/workflow.types';

/**
 * The producer for artifact runs, over two queues: `workflow` for POST and
 * POLL, `workflow-document` for DOCUMENT (`queueNameFor`), so a burst of
 * documents can't hold up text runs.
 */
@Injectable()
export class WorkflowQueue implements OnModuleInit, OnModuleDestroy {
  /** The text queue, `workflow`. */
  public queue: Queue;
  /** The document queue, `workflow-document`. */
  public documentQueue: Queue;
  constructor(private config: ConfigService) {}

  onModuleInit() {
    const connection = { url: this.config.get<string>('REDIS_URL')! };
    this.queue = new Queue(QUEUE_NAME, { connection });
    this.documentQueue = new Queue(DOCUMENT_QUEUE_NAME, { connection });
  }

  async onModuleDestroy() {
    await Promise.all([this.queue.close(), this.documentQueue.close()]);
  }

  /** The queue named `name`. */
  queueFor(name: WorkflowQueueName): Queue {
    return name === DOCUMENT_QUEUE_NAME ? this.documentQueue : this.queue;
  }

  /**
   * Kick off an artifact generation run on the queue for its type. `jobId` is
   * the `WorkflowRun._id` — the one identity across run, job, and Redis
   * stream — so the SSE endpoint can relay events keyed by the same id the 202
   * handed the client. `attempts: 3` with exponential backoff is the engine's
   * retry budget: transient step failures ride it, terminal ones raise
   * `UnrecoverableError` to stop early. `removeOnFail: false` keeps the failed
   * job for the terminal-failure handler.
   */
  async addArtifactRunJob(runId: string, input: BuildInput) {
    await this.queueFor(queueNameFor(input.type)).add(
      `artifact:${input.type}`,
      input,
      {
        jobId: runId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }
}
