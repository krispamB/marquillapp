import { UnrecoverableError } from 'bullmq';
import type { Logger } from '@nestjs/common';
import { WorkflowStep } from '../workflow.constants';
import { RunEventEmitter } from './run-event.emitter';
import { RunEventType } from './run-event.types';
import { buildWorkflow } from './workflow.builder';
import {
  WorkflowError,
  describeError,
  terminal,
  toWorkflowError,
} from './workflow.error';
import type { ArtifactWriter } from '../../artifact/artifact-writer.interface';
import type {
  BuildInput,
  RunRecordHandle,
  RunState,
  StepContext,
  StepHandlerMap,
} from './workflow.types';

export interface RunDeps {
  ctx: StepContext;
  /** Owns `seq`, so the core — never a step — stamps the ordering. */
  emitter: RunEventEmitter;
  handlers: StepHandlerMap;
}

/**
 * The core wraps every step, so lifecycle events are guaranteed complete and
 * match the builder's honest sequence. Steps emit only what the core cannot
 * observe (`step.progress`), and the meter emits `usage.tick` itself.
 *
 * A retry re-runs the whole job from step 1 — there are no per-step checkpoints.
 * That is safe because the run targets a fixed `(artifactId, version)` created
 * as `GENERATING` at kickoff, so every step, `PERSIST_VERSION` included,
 * overwrites rather than appends.
 */
export async function runWorkflow(
  input: BuildInput,
  { ctx, emitter, handlers }: RunDeps,
): Promise<RunState> {
  const { steps, name } = buildWorkflow(input);
  const total = steps.length;

  // Attempt-scoped: a whole-job retry starts its accounting from zero, so only
  // the winning attempt's spend is ever committed.
  ctx.meter.reset();

  ctx.logger.log(`Starting workflow ${name} for run ${ctx.run.runId}`);
  emitter.emit({
    type: RunEventType.RUN_STARTED,
    data: { kind: input.kind, type: input.type, steps },
  });

  await assertBalance(ctx, emitter);

  let state: RunState = { input };

  for (let index = 0; index < total; index++) {
    const step = steps[index];
    const handler = handlers[step];

    if (!handler) {
      // The builder emitted a step nothing implements: a wiring bug, and a cold
      // replay cannot conjure the handler.
      throw await announceFailure(
        emitter,
        step,
        terminal(`No handler for step ${step}`),
      );
    }

    await ctx.run.setCurrentStep(step);
    emitter.emit({
      type: RunEventType.STEP_STARTED,
      data: { step, index, total },
    });

    let patch: Partial<RunState>;
    try {
      patch = await handler(state, ctx);
    } catch (error: unknown) {
      throw await announceFailure(emitter, step, toWorkflowError(error));
    }

    // Steps write only their own slots, so the merge can be shallow.
    state = { ...state, ...patch };
    emitter.emit({
      type: RunEventType.STEP_COMPLETED,
      data: { step, index, total },
    });
  }

  // Persist before announcing: a client that reacts to `run.completed` by
  // re-reading the run must never find it still RUNNING.
  await ctx.run.complete(ctx.meter.creditsUsed);
  await ctx.meter.commit();

  emitter.emit({
    type: RunEventType.RUN_COMPLETED,
    data: { artifactId: input.artifactId, version: input.version },
  });
  await emitter.flush();

  return state;
}

/**
 * Guards the race where a user's balance drained between enqueue and pickup.
 * Confirmed exhaustion is terminal because a retry cannot refill a wallet.
 * Infrastructure and configuration failures keep their normal retry taxonomy.
 */
async function assertBalance(
  ctx: StepContext,
  emitter: RunEventEmitter,
): Promise<void> {
  try {
    await ctx.meter.assertBalance();
  } catch (error: unknown) {
    await emitter.flush();
    const workflowError = toWorkflowError(error);
    throw workflowError.retryable
      ? workflowError
      : new UnrecoverableError(workflowError.reason);
  }
}

/**
 * Announce the step failure and hand back the error to throw, in the shape
 * BullMQ reads: a terminal error becomes `UnrecoverableError`, which stops
 * retries immediately; a transient one rides the `attempts: 3` budget unchanged.
 *
 * `run.failed` is deliberately *not* emitted here — a will-retry failure is not
 * the end of the run. Only the terminal-failure handler decides that.
 */
async function announceFailure(
  emitter: RunEventEmitter,
  step: WorkflowStep,
  error: WorkflowError,
): Promise<Error> {
  emitter.emit({
    type: RunEventType.STEP_FAILED,
    data: { step, retryable: error.retryable, message: error.reason },
  });
  await emitter.flush();

  return error.retryable ? error : new UnrecoverableError(error.reason);
}

export interface TerminalFailureDeps {
  artifacts: Pick<ArtifactWriter, 'failVersion'>;
  run: Pick<RunRecordHandle, 'fail'>;
  emitter: RunEventEmitter;
  logger: Logger;
}

export interface TerminalFailure {
  artifactId: string;
  version: number;
  failureReason: string;
}

/**
 * Fired only on attempts-exhausted or `UnrecoverableError`, mirroring the
 * `media-upload` `exhausted` idiom.
 *
 * **No credit commit** — the operator absorbs the spend of a failed run. Each
 * write is isolated: this is the last line of defence, and one broken write must
 * not strand the run in `RUNNING` or deny the client its `run.failed`.
 */
export async function handleTerminalFailure(
  { artifacts, run, emitter, logger }: TerminalFailureDeps,
  { artifactId, version, failureReason }: TerminalFailure,
): Promise<void> {
  const report = (what: string, error: unknown): void =>
    logger.error(
      `Terminal-failure handler could not ${what} for artifact ${artifactId} v${version}: ${describeError(error)}`,
    );

  try {
    await artifacts.failVersion(artifactId, version, failureReason);
  } catch (error: unknown) {
    report('mark the version FAILED', error);
  }

  try {
    await run.fail(failureReason);
  } catch (error: unknown) {
    report('mark the run FAILED', error);
  }

  emitter.emit({
    type: RunEventType.RUN_FAILED,
    data: { failureReason },
  });
  await emitter.flush();
}
