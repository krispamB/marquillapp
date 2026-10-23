import type { WorkerOptions } from 'bullmq';
import { readIntEnv, type EnvSource } from '../../common/env';
import {
  DOCUMENT_QUEUE_NAME,
  QUEUE_NAME,
  type WorkflowQueueName,
} from '../workflow.constants';

/** The per-queue `Worker` options; the connection is added by the caller. */
export type WorkflowWorkerOptions = Required<
  Pick<
    WorkerOptions,
    'concurrency' | 'lockDuration' | 'maxStalledCount' | 'stalledInterval'
  >
>;

export const DEFAULT_WORKFLOW_CONCURRENCY = 1;
export const DEFAULT_WORKFLOW_LOCK_DURATION_MS = 30_000;

/**
 * The options for the two artifact-run workers, keyed by queue:
 * `WORKFLOW_TEXT_CONCURRENCY` for `workflow` (POST, POLL, and DOCUMENT jobs
 * enqueued before the split), `WORKFLOW_DOCUMENT_CONCURRENCY` for
 * `workflow-document`, and `WORKFLOW_LOCK_DURATION_MS` for both. A bad value
 * throws, naming the key, so it fails the boot.
 */
export function workflowWorkerOptions(
  source: EnvSource,
): Record<WorkflowQueueName, WorkflowWorkerOptions> {
  const lockDuration = readIntEnv(source, 'WORKFLOW_LOCK_DURATION_MS', {
    default: DEFAULT_WORKFLOW_LOCK_DURATION_MS,
    min: 1000,
  });
  const withConcurrency = (key: string): WorkflowWorkerOptions => ({
    concurrency: readIntEnv(source, key, {
      default: DEFAULT_WORKFLOW_CONCURRENCY,
      min: 1,
    }),
    lockDuration,
    // A job whose lock lapsed is restarted twice, then failed.
    maxStalledCount: 2,
    stalledInterval: 10_000,
  });
  return {
    [QUEUE_NAME]: withConcurrency('WORKFLOW_TEXT_CONCURRENCY'),
    [DOCUMENT_QUEUE_NAME]: withConcurrency('WORKFLOW_DOCUMENT_CONCURRENCY'),
  };
}
