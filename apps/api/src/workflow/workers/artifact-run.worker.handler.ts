import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import type { AgentRunner } from '../../agent/agent-runner.interface';
import type { ArtifactWriter } from '../../artifact/artifact-writer.interface';
import type { CreditMeterService } from '../../feature-gating/credit-meter.service';
import type { FeatureGatingService } from '../../feature-gating/feature-gating.service';
import { FeatureGateForbiddenException } from '../../feature-gating/feature-gating.exception';
import { RunKind } from '../../database/schemas';
import { RunCreditMeter } from '../engine/run-credit-meter';
import {
  RunEventEmitter,
  type RunEventRedis,
} from '../engine/run-event.emitter';
import type { EmittedEvent } from '../engine/run-event.types';
import { handleTerminalFailure, runWorkflow } from '../engine/workflow.engine';
import { describeError } from '../engine/workflow.error';
import type {
  BuildInput,
  CarouselRenderer,
  RunRecordHandle,
  StepContext,
} from '../engine/workflow.types';
import { artifactStepHandlers } from '../steps';

/** The narrow slice of `WorkflowRunService` the worker needs. */
export interface RunRecordStore {
  handleFor(runId: string): RunRecordHandle;
}

export interface ArtifactRunDeps {
  agent: AgentRunner;
  artifacts: ArtifactWriter;
  renderer: CarouselRenderer;
  creditMeter: CreditMeterService;
  featureGating: FeatureGatingService;
  runs: RunRecordStore;
  redis: RunEventRedis;
  logger: Logger;
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
  private readonly emitters = new Map<string, RunEventEmitter>();

  constructor(private readonly deps: ArtifactRunDeps) {}

  async process(job: Job<BuildInput>): Promise<void> {
    const runId = this.runIdOf(job);
    const { logger, redis, creditMeter, runs } = this.deps;

    if (job.data.kind === RunKind.INITIAL && job.data.withResearch) {
      try {
        await this.deps.featureGating.assertResearchAccess(job.data.userId);
      } catch (error: unknown) {
        if (error instanceof FeatureGateForbiddenException) {
          throw new UnrecoverableError('research is not available on this plan');
        }
        throw error;
      }
    }

    const emitter = new RunEventEmitter(redis, runId, logger);
    this.emitters.set(runId, emitter);

    const emit = (event: EmittedEvent): void => emitter.emit(event);
    const ctx: StepContext = {
      logger,
      agent: this.deps.agent,
      artifacts: this.deps.artifacts,
      renderer: this.deps.renderer,
      meter: new RunCreditMeter(creditMeter, job.data.userId, emit, logger),
      emit,
      run: runs.handleFor(runId),
    };

    await runWorkflow(job.data, {
      ctx,
      emitter,
      handlers: artifactStepHandlers,
    });

    // Only on success: a failure hands the emitter, and its `seq`, to `onFailed`.
    this.emitters.delete(runId);
  }

  /**
   * Fired on every failed attempt. Only the last one is the run's end; the
   * others leave the version `GENERATING` and ride the attempt budget, having
   * already emitted `step.failed` from inside the engine.
   */
  async onFailed(job: Job<BuildInput>, error: Error): Promise<void> {
    const { logger } = this.deps;

    const runId = job.id;
    if (!runId) {
      logger.error(`Artifact run job failed without an id: ${error.message}`);
      return;
    }

    // Retained across attempts so `run.failed` continues the run's `seq`; a
    // retry that ran here handed its emitter over on the way out. The retry path
    // is done with it either way — the next attempt builds a fresh one.
    const emitter =
      this.emitters.get(runId) ??
      new RunEventEmitter(this.deps.redis, runId, logger);
    this.emitters.delete(runId);

    if (!isTerminalJobFailure(job, error)) {
      logger.warn(
        `Artifact run ${runId} failed (attempt ${job.attemptsMade}/${job.opts.attempts ?? 1}); retrying: ${error.message}`,
      );
      return;
    }

    // Absent from the map only when the attempt ran in another process; a fresh
    // emitter restarts `seq`, a lesser evil than losing the client's `run.failed`.
    logger.error(`Artifact run ${runId} failed terminally: ${error.message}`);
    const failureReason = isUnrecoverableFailure(error)
      ? describeError(error)
      : TEMPORARY_FAILURE_REASON;

    await handleTerminalFailure(
      {
        artifacts: this.deps.artifacts,
        run: this.deps.runs.handleFor(runId),
        emitter,
        logger,
      },
      {
        artifactId: job.data.artifactId,
        version: job.data.version,
        failureReason,
      },
    );
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
