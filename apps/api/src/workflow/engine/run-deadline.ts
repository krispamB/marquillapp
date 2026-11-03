import { FailureCode, WorkflowStep } from '../workflow.constants';
import { transient } from './workflow.error';
import type { RunDeadlineGuard } from './workflow.types';

/**
 * The wall-clock bound on one job attempt (spec §7.5). DOCUMENT steps check it
 * before each model call and render session, so a run that keeps meeting slow
 * calls gives up and rides the job's retry instead of hanging.
 */
export class RunDeadline implements RunDeadlineGuard {
  /**
   * @param endsAt epoch milliseconds after which nothing new may start.
   * @param now injectable for tests.
   */
  constructor(
    private readonly endsAt: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** A deadline `budgetMs` from now. */
  static after(budgetMs: number, now: () => number = Date.now): RunDeadline {
    return new RunDeadline(now() + budgetMs, now);
  }

  /**
   * Milliseconds until the deadline, never negative. A model call uses it to
   * bound its own timeout and retries, so it cannot outlive the attempt.
   *
   * @param reserveMs time kept back for what must still run afterwards: a
   *   render's wait for a Browserless slot keeps room for the session itself.
   */
  remainingMs(reserveMs = 0): number {
    return Math.max(0, this.endsAt - this.now() - reserveMs);
  }

  /**
   * Throws **transient** once the deadline has passed. If that ends the run,
   * its code follows the step: `render.unavailable` in `RENDER_PDF`,
   * `internal` elsewhere.
   */
  assertTimeLeft(step: WorkflowStep, before: string): void {
    const now = this.now();
    if (now < this.endsAt) return;
    throw transient(
      `The job attempt passed its deadline by ${now - this.endsAt}ms before ${before}`,
      undefined,
      step === WorkflowStep.RENDER_PDF
        ? FailureCode.RENDER_UNAVAILABLE
        : undefined,
    );
  }
}
