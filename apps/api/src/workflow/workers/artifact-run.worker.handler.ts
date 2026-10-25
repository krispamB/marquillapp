import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import type { AgentRunner } from '../../agent/agent-runner.interface';
import type { ArtifactWriter } from '../../artifact/artifact-writer.interface';
import type { CreditMeterService } from '../../feature-gating/credit-meter.service';
import type { FeatureGatingService } from '../../feature-gating/feature-gating.service';
import { FeatureGateForbiddenException } from '../../feature-gating/feature-gating.exception';
import { ArtifactType, RunKind } from '../../database/schemas';
import {
  DOCUMENT_RUN_DEADLINE_MS,
  FAILURE_REASONS,
} from '../workflow.constants';
import { alertSubject } from '../engine/alert';
import {
  DocumentRunDiagnostics,
  type DiagnosticsEnd,
} from '../engine/document-run-diagnostics';
import { RunCreditMeter } from '../engine/run-credit-meter';
import { RunDeadline } from '../engine/run-deadline';
import {
  RunEventEmitter,
  type RunEventRedis,
} from '../engine/run-event.emitter';
import type { EmittedEvent } from '../engine/run-event.types';
import { handleTerminalFailure, runWorkflow } from '../engine/workflow.engine';
import { describeError, failureCodeOf } from '../engine/workflow.error';
import type {
  BuildInput,
  DesignSystemResolver,
  DocumentObjectStore,
  DocumentDiagnostics,
  DocumentFontInliner,
  DocumentRenderer,
  RunRecordHandle,
  StepContext,
} from '../engine/workflow.types';
import type { InflightRunLimiter } from '../inflight-run-limiter';
import { artifactStepHandlers } from '../steps';
import { STALLED_FAILURE_REASON } from './stalled-failure';

/** The narrow slice of `WorkflowRunService` the worker needs. */
export interface RunRecordStore {
  handleFor(runId: string): RunRecordHandle;
}

export interface ArtifactRunDeps {
  agent: AgentRunner;
  artifacts: ArtifactWriter;
  designSystems: DesignSystemResolver;
  renderer: DocumentRenderer;
  fonts: DocumentFontInliner;
  objects: DocumentObjectStore;
  creditMeter: CreditMeterService;
  featureGating: FeatureGatingService;
  runs: RunRecordStore;
  /** The per-user in-flight cap; a no-op while it is off. */
  inflight: Pick<InflightRunLimiter, 'refresh' | 'release'>;
  redis: RunEventRedis;
  logger: Logger;
}

/** What one job attempt leaves behind for `onFailed`. */
interface JobAttemptState {
  emitter: RunEventEmitter;
  meter: RunCreditMeter;
  diagnostics: DocumentRunDiagnostics;
  /** Holds the job attempt's LLM usage, which `fail` writes. */
  run: RunRecordHandle;
}

const TEMPORARY_FAILURE_REASON =
  'Generation is temporarily unavailable. Please try again.';

const isUnrecoverableFailure = (error: Error): boolean =>
  error instanceof UnrecoverableError || error.name === 'UnrecoverableError';

/**
 * BullMQ stops retrying either because a step declared its failure terminal, or
 * because the attempt budget ran out. `UnrecoverableError` is matched by name as
 * well as identity: a duplicated `bullmq` in the module graph would defeat
 * `instanceof`, and getting this wrong would silently strand a run `RUNNING`.
 */
export const isTerminalJobFailure = (job: Job, error: Error): boolean =>
  isUnrecoverableFailure(error) || job.attemptsMade >= (job.opts.attempts ?? 1);

/**
 * The `workflow` queue's consumer: it builds a `StepContext` out of the six role
 * interfaces and hands the job to the engine.
 *
 * It is a class rather than the free functions the other handlers use because
 * the emitter must survive the processor. `seq` is per-run and monotonic, and
 * BullMQ fires `failed` *after* the processor has returned — so a terminal
 * handler that built its own emitter would announce `run.failed` with `seq: 1`,
 * behind every event the run had already emitted, and a client watching for gaps
 * would see the counter run backwards.
 */
export class ArtifactRunProcessor {
  private readonly jobAttempts = new Map<string, JobAttemptState>();
  /** `onFailed` calls still running, so a shutdown can wait for them. */
  private readonly inFlightFailures = new Set<Promise<void>>();

  constructor(private readonly deps: ArtifactRunDeps) {}

  async process(job: Job<BuildInput>): Promise<void> {
    const runId = this.runIdOf(job);
    const { logger, redis, creditMeter, runs } = this.deps;
    const run = runs.handleFor(runId);

    // The run is still going: push its in-flight lease out for this attempt.
    await this.deps.inflight.refresh(job.data.userId, runId);

    // One entitlement per job attempt: the research check, the balance check
    // and the debit all reuse it, so gating costs a subscription read and a
    // usage read. Resolved per job attempt, since a plan can change while a
    // retry waits.
    const [entitlement, prior] = await Promise.all([
      this.deps.featureGating.resolveEntitlement(job.data.userId),
      this.readPriorDiagnostics(job, run),
    ]);

    if (job.data.kind === RunKind.INITIAL && job.data.withResearch) {
      try {
        await this.deps.featureGating.assertResearchAccess(
          job.data.userId,
          entitlement,
        );
      } catch (error: unknown) {
        if (error instanceof FeatureGateForbiddenException) {
          throw new UnrecoverableError(
            'research is not available on this plan',
          );
        }
        throw error;
      }
    }

    const emitter = new RunEventEmitter(redis, runId, logger);
    await this.recordQueueWait(job, run);
    const subject = alertSubject(runId, job.data);
    const meter = new RunCreditMeter(
      creditMeter,
      job.data.userId,
      subject,
      (event) => emitter.emit(event),
      logger,
      entitlement,
    );
    // `attemptsMade` counts the job attempts that already failed.
    const diagnostics = new DocumentRunDiagnostics({
      runId,
      input: job.data,
      jobAttempt: job.attemptsMade + 1,
      prior,
    });
    this.jobAttempts.set(runId, { emitter, meter, diagnostics, run });

    const emit = (event: EmittedEvent): void => emitter.emit(event);
    const ctx: StepContext = {
      logger,
      agent: this.deps.agent,
      artifacts: this.deps.artifacts,
      designSystems: this.deps.designSystems,
      renderer: this.deps.renderer,
      fonts: this.deps.fonts,
      objects: this.deps.objects,
      meter,
      // Per job attempt: a retry gets a fresh budget.
      deadline: RunDeadline.after(DOCUMENT_RUN_DEADLINE_MS),
      diagnostics,
      emit,
      run,
      // Enqueued right after the run was created, and the same for every job
      // attempt and stall restart, so a retry past midnight keeps the date.
      runCreatedAt: new Date(job.timestamp),
    };

    await runWorkflow(job.data, {
      ctx,
      emitter,
      handlers: artifactStepHandlers,
    });

    await this.deps.inflight.release(job.data.userId, runId);

    // Only on success: a failure hands the job attempt, and its emitter's
    // `seq`, to `onFailed`.
    this.jobAttempts.delete(runId);

    await this.recordDocumentRun(job, runId, diagnostics, {
      outcome: 'READY',
      credits: meter.creditsUsed,
    });
  }

  /**
   * Fired on every failed job attempt. Only the last one is the run's end;
   * the others leave the version `GENERATING` and ride the attempt budget,
   * having already emitted `step.failed` from inside the engine.
   *
   * A DOCUMENT run's error text can quote model output, so it is kept in the
   * run's diagnostics and never logged (spec §11.6); the logs get its code.
   */
  onFailed(job: Job<BuildInput>, error: Error): Promise<void> {
    const handling = this.handleFailedJobAttempt(job, error);
    const tracked = handling.then(
      () => undefined,
      () => undefined,
    );
    this.inFlightFailures.add(tracked);
    void tracked.then(() => this.inFlightFailures.delete(tracked));
    return handling;
  }

  /**
   * Resolves once every `onFailed` call has settled, including any that start
   * while it waits. The worker's shutdown awaits this after closing the
   * BullMQ workers, so a terminal failure is written before Mongo and Redis
   * close.
   */
  async idle(): Promise<void> {
    while (this.inFlightFailures.size > 0) {
      await Promise.all(this.inFlightFailures);
    }
  }

  private async handleFailedJobAttempt(
    job: Job<BuildInput>,
    error: Error,
  ): Promise<void> {
    const { logger } = this.deps;
    const isDocument = job.data.type === ArtifactType.DOCUMENT;
    // A DOCUMENT failure carries a stable code with its own client wording;
    // anything else is `internal`, described as before.
    const failureCode = failureCodeOf(error);
    const cause = isDocument ? failureCode : error.message;

    const runId = job.id;
    if (!runId) {
      logger.error(`Artifact run job failed without an id: ${cause}`);
      return;
    }

    // Retained across job attempts so `run.failed` continues the run's `seq`;
    // a retry that ran here handed its emitter over on the way out. The retry
    // path is done with it either way — the next job attempt builds a fresh one.
    const jobAttempt = this.jobAttempts.get(runId);
    const emitter =
      jobAttempt?.emitter ??
      new RunEventEmitter(this.deps.redis, runId, logger);
    this.jobAttempts.delete(runId);
    const diagnostics = () =>
      jobAttempt?.diagnostics ?? this.diagnosticsFromRecord(job, runId);
    const credits = jobAttempt?.meter.creditsUsed ?? 0;

    if (!isTerminalJobFailure(job, error)) {
      logger.warn(
        `Artifact run ${runId} failed (attempt ${job.attemptsMade}/${job.opts.attempts ?? 1}); retrying: ${cause}`,
      );
      if (isDocument) {
        await this.recordDocumentRun(job, runId, await diagnostics(), {
          outcome: 'RETRYING',
          failureCode,
          message: error.message,
          credits,
        });
      }
      return;
    }

    // Absent from the map only when the job attempt ran in another process; a
    // fresh emitter restarts `seq`, a lesser evil than losing the client's
    // `run.failed`.
    logger.error(`Artifact run ${runId} failed terminally: ${cause}`);
    // A stalled-out job is unrecoverable, but BullMQ's reason means nothing
    // to the user.
    const failureReason =
      FAILURE_REASONS[failureCode] ??
      (isUnrecoverableFailure(error) && error.message !== STALLED_FAILURE_REASON
        ? describeError(error)
        : TEMPORARY_FAILURE_REASON);

    let storedCode: Awaited<ReturnType<typeof handleTerminalFailure>>;
    try {
      storedCode = await handleTerminalFailure(
        {
          artifacts: this.deps.artifacts,
          run: jobAttempt?.run ?? this.deps.runs.handleFor(runId),
          emitter,
          logger,
        },
        {
          artifactId: job.data.artifactId,
          version: job.data.version,
          failureCode,
          failureReason,
        },
      );
    } finally {
      // Every terminal report, a stalled job's included, ends here; releasing
      // twice for one run is harmless.
      await this.deps.inflight.release(job.data.userId, runId);
    }

    // The run had already ended, and been described, through another report.
    if (storedCode === null) return;

    if (isDocument) {
      await this.recordDocumentRun(job, runId, await diagnostics(), {
        outcome: 'FAILED',
        failureCode: storedCode,
        message: error.message,
        credits,
      });
    }
  }

  /**
   * DOCUMENT: writes the run's diagnostics and, once the run has ended, logs
   * its one completion line (spec §11.1, §11.6). Best-effort: describing a
   * run must never change how it ended.
   */
  private async recordDocumentRun(
    job: Job<BuildInput>,
    runId: string,
    diagnostics: DocumentRunDiagnostics,
    end: DiagnosticsEnd,
  ): Promise<void> {
    if (job.data.type !== ArtifactType.DOCUMENT) return;
    const { logger } = this.deps;

    const finished = diagnostics.finish(end);
    try {
      await this.deps.runs
        .handleFor(runId)
        .saveDocumentDiagnostics(
          finished.diagnostics,
          finished.failedCandidateSource,
        );
    } catch (error: unknown) {
      logger.error(
        `Could not save the diagnostics of run ${runId}: ${describeError(error)}`,
      );
    }
    if (end.outcome !== 'RETRYING') logger.log(finished.completionLine);
  }

  /**
   * The first job attempt's wait from enqueue to pickup. A later pickup's
   * would include the earlier attempts: a retry's their backoff, a stall
   * restart's the stalled run. `attemptsStarted` counts both, where
   * `attemptsMade` misses a stall. Best-effort: measuring the queue must
   * never fail the job.
   */
  private async recordQueueWait(
    job: Job<BuildInput>,
    run: RunRecordHandle,
  ): Promise<void> {
    if (job.attemptsStarted > 1 || job.processedOn === undefined) return;
    try {
      await run.recordQueueWait(job.processedOn - job.timestamp);
    } catch (error: unknown) {
      this.deps.logger.warn(
        `Could not record the queue wait of run ${run.runId}: ${describeError(error)}`,
      );
    }
  }

  /** DOCUMENT: what earlier job attempts recorded. Best-effort. */
  private async readPriorDiagnostics(
    job: Job<BuildInput>,
    run: RunRecordHandle,
  ): Promise<DocumentDiagnostics | undefined> {
    if (job.data.type !== ArtifactType.DOCUMENT) return undefined;
    try {
      return await run.readDocumentDiagnostics();
    } catch (error: unknown) {
      this.deps.logger.warn(
        `Could not read the diagnostics of run ${run.runId}: ${describeError(error)}`,
      );
      return undefined;
    }
  }

  /**
   * The failed job attempt ran in another process, or never started: what
   * the run record holds is all there is to describe. That is the earlier
   * job attempts' diagnostics and the checkpoint, whose text stands in as
   * the failed candidate.
   */
  private async diagnosticsFromRecord(
    job: Job<BuildInput>,
    runId: string,
  ): Promise<DocumentRunDiagnostics> {
    const run = this.deps.runs.handleFor(runId);
    const diagnostics = new DocumentRunDiagnostics({
      runId,
      input: job.data,
      jobAttempt: job.attemptsMade,
      prior: await this.readPriorDiagnostics(job, run),
    });
    try {
      const accepted = await run.readAcceptedCandidate();
      if (accepted) {
        diagnostics.recordAccepted(accepted.candidate, accepted.repairsSpent);
      }
    } catch (error: unknown) {
      this.deps.logger.warn(
        `Could not read the checkpoint of run ${runId}: ${describeError(error)}`,
      );
    }
    return diagnostics;
  }

  /**
   * Kickoff sets the BullMQ `jobId` to the `WorkflowRun`'s `_id`: one identity
   * across run, job, and Redis stream. Without it there is nothing to write
   * events or a failure verdict against.
   */
  private runIdOf(job: Job<BuildInput>): string {
    if (!job.id) {
      throw new UnrecoverableError('Artifact run job has no id');
    }
    return job.id;
  }
}
