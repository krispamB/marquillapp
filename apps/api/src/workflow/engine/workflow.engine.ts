import { UnrecoverableError } from 'bullmq';
import type { Logger } from '@nestjs/common';
import { ArtifactType, RunKind } from '../../database/schemas';
import type { ArtifactContent } from '../../artifact/schemas';
import { FailureCode, WorkflowStep } from '../workflow.constants';
import { RunEventEmitter } from './run-event.emitter';
import { RunEventType } from './run-event.types';
import { buildWorkflow } from './workflow.builder';
import {
  WorkflowError,
  describeError,
  terminal,
  toWorkflowError,
  withFailureCode,
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
 * as a `GENERATING` Attempt at kickoff, and `PERSIST_VERSION`'s promotion is
 * idempotent: a replay that finds the version already `READY` succeeds.
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

    ctx.diagnostics.stepStarted(step);
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
    ctx.diagnostics.stepCompleted(step);
    emitter.emit({
      type: RunEventType.STEP_COMPLETED,
      data: { step, index, total },
    });
  }

  // Persist before announcing: a client that reacts to `run.completed` by
  // re-reading the run must never find it still RUNNING.
  await ctx.run.complete(ctx.meter.creditsUsed);

  // Emit is fire-and-forget, so the stream write overlaps the debit below. The
  // user sees the finished run without waiting on the wallet. Never
  // Promise.all complete + commit: the run must be persisted first.
  emitter.emit({
    type: RunEventType.RUN_COMPLETED,
    data: {
      artifactId: input.artifactId,
      version: input.version,
      ...inlineResult(input, state),
    },
  });
  try {
    await ctx.meter.commit();
  } finally {
    // The run is already announced, so make sure the event is written even
    // when the debit rejects.
    await emitter.flush();
  }

  return state;
}

/**
 * POST and POLL only: what `PERSIST_VERSION` promoted, so the web can render
 * the finished version without the follow-up read. `title` rides along on an
 * INITIAL run, the only run `promoteVersion` writes one for. Verified equal
 * to what is stored: GENERATE already parsed `state.content` with the
 * per-type content schema that `promoteVersion` re-parses it with, and that
 * parse only strips unknown keys, so the second one changes nothing. A
 * DOCUMENT's content is a signed PDF link minted per read, so it is never
 * inlined.
 */
function inlineResult(
  input: BuildInput,
  state: RunState,
): { content?: ArtifactContent; title?: string } {
  if (input.type === ArtifactType.DOCUMENT || !state.content) return {};
  return {
    content: state.content,
    ...(input.kind === RunKind.INITIAL && state.generatedTitle !== undefined
      ? { title: state.generatedTitle }
      : {}),
  };
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
  if (!error.silent) {
    emitter.emit({
      type: RunEventType.STEP_FAILED,
      data: { step, retryable: error.retryable, message: error.reason },
    });
  }
  await emitter.flush();

  return error.retryable
    ? withFailureCode(error, error.code)
    : withFailureCode(new UnrecoverableError(error.reason), error.code);
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
  failureCode: FailureCode;
  failureReason: string;
}

export const ARTIFACT_DELETED_FAILURE_REASON =
  'The artifact was deleted before the run finished.';

/**
 * Fired only on attempts-exhausted or `UnrecoverableError`, mirroring the
 * `media-upload` `exhausted` idiom. The failed Attempt and the run store the
 * same `failureCode` and `failureReason` that `run.failed` carries.
 *
 * **No credit commit** — the operator absorbs the spend of a failed run. Each
 * write is isolated: this is the last line of defence, and one broken write must
 * not strand the run in `RUNNING` or deny the client its `run.failed`.
 *
 * An artifact the user deleted mid-run fails its run silently, as `internal`:
 * the client that deleted it is not waiting for the result.
 *
 * Idempotent: a run that is no longer `RUNNING` already ended, through an
 * earlier call for the same job (the worker's `failed` event and the
 * stalled-job listener can both report one) or a completion. It is left as it
 * is and nothing is emitted. The run's conditional write decides the race, so
 * this holds across processes.
 *
 * Returns the code the run was failed with, or `null` when it had already
 * ended.
 */
export async function handleTerminalFailure(
  { artifacts, run, emitter, logger }: TerminalFailureDeps,
  { artifactId, version, failureCode, failureReason }: TerminalFailure,
): Promise<FailureCode | null> {
  const report = (what: string, error: unknown): void =>
    logger.error(
      `Terminal-failure handler could not ${what} for artifact ${artifactId} v${version}: ${describeError(error)}`,
    );

  let deleted = false;
  try {
    const outcome = await artifacts.failVersion(
      artifactId,
      version,
      failureCode,
      failureReason,
    );
    deleted = outcome === 'ARTIFACT_DELETED';
  } catch (error: unknown) {
    report('mark the version FAILED', error);
  }

  let alreadyEnded = false;
  try {
    const outcome = await (deleted
      ? run.fail(FailureCode.INTERNAL, ARTIFACT_DELETED_FAILURE_REASON)
      : run.fail(failureCode, failureReason));
    alreadyEnded = outcome === 'ALREADY_ENDED';
  } catch (error: unknown) {
    report('mark the run FAILED', error);
  }

  if (alreadyEnded) {
    logger.log(
      `Run for artifact ${artifactId} v${version} had already ended; not failing it again`,
    );
    return null;
  }

  if (deleted) {
    logger.log(
      `Run for artifact ${artifactId} v${version} failed after the artifact was deleted`,
    );
  } else {
    emitter.emit({
      type: RunEventType.RUN_FAILED,
      data: { code: failureCode, failureReason },
    });
  }
  await emitter.flush();
  return deleted ? FailureCode.INTERNAL : failureCode;
}
