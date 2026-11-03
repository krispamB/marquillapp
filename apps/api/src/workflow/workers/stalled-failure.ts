import type { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import type { BuildInput } from '../engine/workflow.types';

/**
 * The `failedReason` BullMQ gives a job that stalled more than
 * `maxStalledCount` times (`moveStalledJobsToWait` in bullmq 5.x).
 */
export const STALLED_FAILURE_REASON = 'job stalled more than allowable limit';

/** A `QueueEvents` `failed` event; it carries no job data. */
export interface QueueFailedEvent {
  jobId: string;
  failedReason: string;
}

export interface StalledFailureDeps {
  getJob(jobId: string): Promise<Job<BuildInput> | undefined>;
  /** `ArtifactRunProcessor.onFailed`, which ends the run idempotently. */
  onFailed(job: Job<BuildInput>, error: Error): Promise<void>;
  logger: Pick<Logger, 'warn'>;
}

/**
 * Ends the run of a job that stalled out, so it does not stay `RUNNING` with
 * the user never told. In bullmq 5.x the stalled checker only marks such a job
 * for failure; the next worker to pick it up fails it, which also fires that
 * worker's `failed` event. This listener is the queue-wide backstop for the
 * same job, so it relies on `onFailed` ending a run at most once.
 */
export async function handleStalledFailure(
  { jobId, failedReason }: QueueFailedEvent,
  deps: StalledFailureDeps,
): Promise<void> {
  if (failedReason !== STALLED_FAILURE_REASON) return;

  const job = await deps.getJob(jobId);
  if (!job) {
    deps.logger.warn(
      `Job ${jobId} stalled out but is gone from the queue; its run cannot be ended here`,
    );
    return;
  }
  await deps.onFailed(job, new UnrecoverableError(failedReason));
}
