import type { Logger } from '@nestjs/common';
import type { UsageRecord } from '../../feature-gating/credit-meter.constants';
import type { CreditMeterService } from '../../feature-gating/credit-meter.service';
import { RunEventType, type EmittedEvent } from './run-event.types';
import { describeError } from './workflow.error';
import type { CreditMeter } from './workflow.types';

/**
 * The stateful, per-run half of credit accounting. `CreditMeterService` owns the
 * pure conversion and the period aggregate; this owns the attempt-scoped
 * accumulator and the `usage.tick` announcement.
 *
 * One instance per attempt-bearing run, constructed in the worker bootstrap.
 */
export class RunCreditMeter implements CreditMeter {
  private used = 0;

  constructor(
    private readonly creditMeterService: CreditMeterService,
    private readonly userId: string,
    private readonly emit: (event: EmittedEvent) => void,
    private readonly logger: Logger,
  ) {}

  get creditsUsed(): number {
    return this.used;
  }

  /**
   * PRD §9 writes this as `assertBalance(userId)` / `commit(runId)`, which suits
   * a stateless service. This meter is constructed per run, so the owner is
   * already bound: taking it again as a parameter would be a second source of
   * truth that could silently disagree with the one `commit` debits.
   */
  assertBalance(): Promise<void> {
    return this.creditMeterService.assertBalance(this.userId);
  }

  /**
   * Accounts and announces in one call. Synchronous, so a step can record usage
   * mid-loop without awaiting; the live count is what lets the SSE stream show a
   * climbing credit total during a long research run.
   */
  record(usage: UsageRecord): void {
    const credits = this.creditMeterService.toCredits(usage);
    this.used += credits;

    this.emit({
      type: RunEventType.USAGE_TICK,
      data: {
        kind: usage.kind,
        credits,
        totalCredits: this.used,
        ...(usage.detail ? { detail: usage.detail } : {}),
      },
    });
  }

  /** Called at the start of each attempt, so a retry cannot double-count. */
  reset(): void {
    this.used = 0;
  }

  /**
   * The only real debit, charged once for the winning attempt. Best-effort:
   * a failed accounting write must never fail a run the user already completed.
   */
  async commit(): Promise<void> {
    if (this.used <= 0) return;

    try {
      await this.creditMeterService.debit(this.userId, this.used);
    } catch (error: unknown) {
      this.logger.error(
        `Failed to settle ${this.used} credits for user ${this.userId}: ${describeError(error)}`,
      );
    }
  }
}
