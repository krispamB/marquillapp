import type { StepContext } from './workflow.types';

/**
 * The run's date as UTC `YYYY-MM-DD`, for the prompts' TODAY line. It reads
 * the run's creation time, never the wall clock, so a job retry past midnight
 * still sees the date the run began on.
 */
export function runDate(ctx: Pick<StepContext, 'runCreatedAt'>): string {
  return ctx.runCreatedAt.toISOString().slice(0, 10);
}
