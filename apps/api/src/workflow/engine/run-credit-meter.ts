import type { Logger } from '@nestjs/common';
import type { UsageRecord } from '../../feature-gating/credit-meter.constants';
import type { CreditMeterService } from '../../feature-gating/credit-meter.service';
import type { Entitlement } from '../../feature-gating/feature-gating.service';
import { FeatureGateForbiddenException } from '../../feature-gating/feature-gating.exception';
import { alert, type AlertSubject } from './alert';
import { RunEventType, type EmittedEvent } from './run-event.types';
import { describeError, terminal } from './workflow.error';
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
    /** The run being metered, named when settlement alerts. */
    private readonly subject: AlertSubject,
    private readonly emit: (event: EmittedEvent) => void,
    private readonly logger: Logger,
    /**
     * The owner's entitlement, resolved once per job attempt. The balance
     * check then reads only usage, and the debit lands in its period. Absent,
     * both resolve it themselves.
     */
    private readonly entitlement?: Entitlement,
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
  async assertBalance(): Promise<void> {
    try {
      await this.creditMeterService.assertBalance(
        this.userId,
        this.entitlement,
      );
    } catch (error: unknown) {
      if (error instanceof FeatureGateForbiddenException) {
        throw terminal('insufficient credits', error);
      }

      throw error;
    }
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
      await this.creditMeterService.debit(
        this.userId,
        this.used,
        this.entitlement?.period,
      );
    } catch (error: unknown) {
      alert(this.logger, 'credit.commit_failed', this.subject, {
        credits: this.used,
      });
      this.logger.error(
        `Settling run ${this.subject.runId} failed: ${describeError(error)}`,
      );
    }
  }
}
