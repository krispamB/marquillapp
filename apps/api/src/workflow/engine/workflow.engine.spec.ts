import { UnrecoverableError } from 'bullmq';

jest.mock(
  '../../database/schemas',
  () => ({
    ArtifactType: { POST: 'POST', POLL: 'POLL', DOCUMENT: 'DOCUMENT' },
    RunKind: { INITIAL: 'INITIAL', REFINE: 'REFINE' },
  }),
  { virtual: true },
);

import { ArtifactType, RunKind } from '../../database/schemas';
import { WorkflowStep } from '../workflow.constants';
import { RunEventType } from './run-event.types';
import { handleTerminalFailure, runWorkflow } from './workflow.engine';
import { WorkflowError, terminal, transient } from './workflow.error';
import type { BuildInput, StepHandlerMap } from './workflow.types';

const { RESOLVE_INPUT, GENERATE, PERSIST_VERSION, RESEARCH } = WorkflowStep;

describe('runWorkflow', () => {
  const makeInput = (overrides: Partial<BuildInput> = {}): BuildInput => ({
    type: ArtifactType.POST,
    withResearch: false,
    kind: RunKind.INITIAL,
    prompt: 'why staff engineers write',
    userId: '665f1b2c3d4e5f6a7b8c9d01',
    artifactId: '665f1b2c3d4e5f6a7b8c9d02',
    version: 1,
    ...overrides,
  });

  const makeDeps = () => {
    const emitter = {
      emit: jest.fn(),
      flush: jest.fn().mockResolvedValue(undefined),
    };
    const meter = {
      creditsUsed: 0,
      assertBalance: jest.fn().mockResolvedValue(undefined),
      record: jest.fn(),
      reset: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined),
    };
    const run = {
      runId: '665f1b2c3d4e5f6a7b8c9d03',
      setCurrentStep: jest.fn().mockResolvedValue(undefined),
      saveResearchContext: jest.fn().mockResolvedValue(undefined),
      complete: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue(undefined),
    };
    const artifacts = {
      setVersionContent: jest.fn().mockResolvedValue(undefined),
      readCurrent: jest.fn(),
      failVersion: jest.fn().mockResolvedValue(undefined),
    };
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

    const ctx = {
      logger,
      agent: { research: jest.fn(), generate: jest.fn() },
      artifacts,
      meter,
      renderer: { render: jest.fn() },
      emit: jest.fn(),
      run,
    };

    const handlers: StepHandlerMap = {
      [RESOLVE_INPUT]: jest.fn().mockResolvedValue({}),
      [GENERATE]: jest
        .fn()
        .mockResolvedValue({ content: { commentary: 'hello' } }),
      [PERSIST_VERSION]: jest.fn().mockResolvedValue({}),
      [RESEARCH]: jest
        .fn()
        .mockResolvedValue({ research: { findings: 'f', sources: [] } }),
    };

    return {
      deps: { ctx: ctx as any, emitter: emitter as any, handlers },
      mocks: { emitter, meter, run, artifacts, logger, ctx, handlers },
    };
  };

  let deps: ReturnType<typeof makeDeps>['deps'];
  let mocks: ReturnType<typeof makeDeps>['mocks'];

  beforeEach(() => {
    jest.clearAllMocks();
    ({ deps, mocks } = makeDeps());
  });

  const emittedTypes = (): string[] =>
    mocks.emitter.emit.mock.calls.map(([event]) => event.type as string);

  const emittedOf = (type: RunEventType): Record<string, unknown>[] =>
    mocks.emitter.emit.mock.calls
      .map(
        ([event]) =>
          event as { type: RunEventType; data: Record<string, unknown> },
      )
      .filter((event) => event.type === type)
      .map((event) => event.data);

  describe('the step loop', () => {
    it('should run every step of the built workflow in order', async () => {
      await runWorkflow(makeInput(), deps);

      expect(mocks.handlers[RESOLVE_INPUT]).toHaveBeenCalledTimes(1);
      expect(mocks.handlers[GENERATE]).toHaveBeenCalledTimes(1);
      expect(mocks.handlers[PERSIST_VERSION]).toHaveBeenCalledTimes(1);
    });

    it('should skip steps the builder omitted', async () => {
      await runWorkflow(makeInput({ withResearch: false }), deps);

      expect(mocks.handlers[RESEARCH]).not.toHaveBeenCalled();
    });

    it('should run RESEARCH when the builder includes it', async () => {
      await runWorkflow(makeInput({ withResearch: true }), deps);

      expect(mocks.handlers[RESEARCH]).toHaveBeenCalledTimes(1);
    });

    it('should seed the state with the build input', async () => {
      const input = makeInput();

      await runWorkflow(input, deps);

      const [state] = (mocks.handlers[RESOLVE_INPUT] as jest.Mock).mock
        .calls[0];
      expect(state).toEqual({ input });
    });

    it('should shallow-merge each step patch into the state', async () => {
      (mocks.handlers[RESOLVE_INPUT] as jest.Mock).mockResolvedValue({
        refine: { priorContent: { commentary: 'old' }, feedback: 'punchier' },
      });

      await runWorkflow(makeInput(), deps);

      const [stateAtPersist] = (mocks.handlers[PERSIST_VERSION] as jest.Mock)
        .mock.calls[0];
      expect(stateAtPersist).toMatchObject({
        refine: { feedback: 'punchier' },
        content: { commentary: 'hello' },
      });
    });

    it('should not let a later patch clobber an untouched slot', async () => {
      await runWorkflow(makeInput({ withResearch: true }), deps);

      const [stateAtPersist] = (mocks.handlers[PERSIST_VERSION] as jest.Mock)
        .mock.calls[0];
      expect(stateAtPersist.research).toEqual({ findings: 'f', sources: [] });
      expect(stateAtPersist.content).toEqual({ commentary: 'hello' });
    });

    it('should return the final accumulated state', async () => {
      const state = await runWorkflow(makeInput(), deps);

      expect(state.content).toEqual({ commentary: 'hello' });
    });

    it('should pass the step context to every handler', async () => {
      await runWorkflow(makeInput(), deps);

      const [, ctx] = (mocks.handlers[GENERATE] as jest.Mock).mock.calls[0];
      expect(ctx).toBe(deps.ctx);
    });

    it('should record the current step on the run at each boundary', async () => {
      await runWorkflow(makeInput(), deps);

      expect(mocks.run.setCurrentStep.mock.calls.map(([s]) => s)).toEqual([
        RESOLVE_INPUT,
        GENERATE,
        PERSIST_VERSION,
      ]);
    });

    it('should fail terminally when a step in the definition has no handler', async () => {
      delete deps.handlers[GENERATE];

      await expect(runWorkflow(makeInput(), deps)).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
    });
  });

  describe('the credit guard', () => {
    it('should reset the attempt-scoped accumulator before the loop', async () => {
      await runWorkflow(makeInput(), deps);

      expect(mocks.meter.reset).toHaveBeenCalledTimes(1);
      expect(mocks.meter.reset.mock.invocationCallOrder[0]).toBeLessThan(
        (mocks.handlers[RESOLVE_INPUT] as jest.Mock).mock
          .invocationCallOrder[0],
      );
    });

    it('should check balance before any step runs', async () => {
      await runWorkflow(makeInput(), deps);

      // The owner is bound onto the meter, so the engine passes no userId here.
      expect(mocks.meter.assertBalance).toHaveBeenCalledTimes(1);
      expect(
        mocks.meter.assertBalance.mock.invocationCallOrder[0],
      ).toBeLessThan(
        (mocks.handlers[RESOLVE_INPUT] as jest.Mock).mock
          .invocationCallOrder[0],
      );
    });

    it('should fail terminally when the balance guard rejects', async () => {
      // Guards the race where balance drained between enqueue and pickup — a
      // retry cannot refill it, so there is nothing to retry.
      mocks.meter.assertBalance.mockRejectedValue(
        terminal('insufficient credits'),
      );

      await expect(runWorkflow(makeInput(), deps)).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
    });

    it('should report insufficient credits as the failure reason', async () => {
      mocks.meter.assertBalance.mockRejectedValue(
        terminal('insufficient credits'),
      );

      await expect(runWorkflow(makeInput(), deps)).rejects.toThrow(
        'insufficient credits',
      );
    });

    it('should preserve a database timeout as a retryable failure', async () => {
      mocks.meter.assertBalance.mockRejectedValue(
        new Error("Socket 'secureConnect' timed out"),
      );

      const error: unknown = await runWorkflow(makeInput(), deps).catch(
        (cause: unknown): unknown => cause,
      );

      expect(error).toBeInstanceOf(WorkflowError);
      expect(error).toMatchObject({
        reason: "Socket 'secureConnect' timed out",
        retryable: true,
      });
      expect(mocks.emitter.flush).toHaveBeenCalledTimes(1);
    });

    it('should not run any step when the balance guard rejects', async () => {
      mocks.meter.assertBalance.mockRejectedValue(new Error('gate'));

      await runWorkflow(makeInput(), deps).catch(() => undefined);

      expect(mocks.handlers[RESOLVE_INPUT]).not.toHaveBeenCalled();
    });

    it('should commit exactly once on success', async () => {
      await runWorkflow(makeInput(), deps);

      expect(mocks.meter.commit).toHaveBeenCalledTimes(1);
    });

    it('should not commit when a step fails', async () => {
      (mocks.handlers[GENERATE] as jest.Mock).mockRejectedValue(
        transient('rate limited'),
      );

      await runWorkflow(makeInput(), deps).catch(() => undefined);

      expect(mocks.meter.commit).not.toHaveBeenCalled();
    });
  });

  describe('lifecycle events', () => {
    it('should bracket the run and each step', async () => {
      await runWorkflow(makeInput(), deps);

      expect(emittedTypes()).toEqual([
        RunEventType.RUN_STARTED,
        RunEventType.STEP_STARTED,
        RunEventType.STEP_COMPLETED,
        RunEventType.STEP_STARTED,
        RunEventType.STEP_COMPLETED,
        RunEventType.STEP_STARTED,
        RunEventType.STEP_COMPLETED,
        RunEventType.RUN_COMPLETED,
      ]);
    });

    it('should announce the honest step list on run.started', async () => {
      await runWorkflow(makeInput({ withResearch: true }), deps);

      expect(emittedOf(RunEventType.RUN_STARTED)[0]).toEqual({
        kind: RunKind.INITIAL,
        type: ArtifactType.POST,
        steps: [RESOLVE_INPUT, RESEARCH, GENERATE, PERSIST_VERSION],
      });
    });

    it('should give every step an exact index and total for the progress bar', async () => {
      await runWorkflow(makeInput(), deps);

      expect(emittedOf(RunEventType.STEP_STARTED)).toEqual([
        { step: RESOLVE_INPUT, index: 0, total: 3 },
        { step: GENERATE, index: 1, total: 3 },
        { step: PERSIST_VERSION, index: 2, total: 3 },
      ]);
    });

    it('should identify the artifact version on run.completed', async () => {
      const input = makeInput();

      await runWorkflow(input, deps);

      expect(emittedOf(RunEventType.RUN_COMPLETED)[0]).toEqual({
        artifactId: input.artifactId,
        version: input.version,
      });
    });

    it('should emit step.failed with the retryable flag when a step throws', async () => {
      (mocks.handlers[GENERATE] as jest.Mock).mockRejectedValue(
        transient('browserless timeout'),
      );

      await runWorkflow(makeInput(), deps).catch(() => undefined);

      expect(emittedOf(RunEventType.STEP_FAILED)[0]).toEqual({
        step: GENERATE,
        retryable: true,
        message: 'browserless timeout',
      });
    });

    it('should emit step.failed with retryable false for a terminal failure', async () => {
      (mocks.handlers[GENERATE] as jest.Mock).mockRejectedValue(
        terminal('zod invalid after repair'),
      );

      await runWorkflow(makeInput(), deps).catch(() => undefined);

      expect(emittedOf(RunEventType.STEP_FAILED)[0]).toMatchObject({
        retryable: false,
      });
    });

    it('should not emit run.completed when a step fails', async () => {
      (mocks.handlers[GENERATE] as jest.Mock).mockRejectedValue(
        transient('blip'),
      );

      await runWorkflow(makeInput(), deps).catch(() => undefined);

      expect(emittedTypes()).not.toContain(RunEventType.RUN_COMPLETED);
    });

    it('should never emit run.failed from the loop — that is the terminal handler', async () => {
      (mocks.handlers[GENERATE] as jest.Mock).mockRejectedValue(
        terminal('nope'),
      );

      await runWorkflow(makeInput(), deps).catch(() => undefined);

      expect(emittedTypes()).not.toContain(RunEventType.RUN_FAILED);
    });

    it('should flush the emitter before returning', async () => {
      await runWorkflow(makeInput(), deps);

      expect(mocks.emitter.flush).toHaveBeenCalled();
    });

    it('should flush the emitter before rethrowing a failure', async () => {
      (mocks.handlers[GENERATE] as jest.Mock).mockRejectedValue(
        transient('blip'),
      );

      await runWorkflow(makeInput(), deps).catch(() => undefined);

      expect(mocks.emitter.flush).toHaveBeenCalled();
    });
  });

  describe('retry semantics', () => {
    it('should rethrow a transient failure as-is so BullMQ retries it', async () => {
      const error = transient('rate limited');
      (mocks.handlers[GENERATE] as jest.Mock).mockRejectedValue(error);

      await expect(runWorkflow(makeInput(), deps)).rejects.toBe(error);
    });

    it('should rethrow a terminal failure as UnrecoverableError to stop retries', async () => {
      (mocks.handlers[GENERATE] as jest.Mock).mockRejectedValue(
        terminal('zod invalid after repair'),
      );

      const caught = await runWorkflow(makeInput(), deps).catch(
        (error: unknown) => error,
      );

      expect(caught).toBeInstanceOf(UnrecoverableError);
      expect((caught as Error).message).toBe('zod invalid after repair');
    });

    it('should classify an unclassified step throw as retryable', async () => {
      (mocks.handlers[GENERATE] as jest.Mock).mockRejectedValue(
        new Error('mongo write concern failed'),
      );

      const caught = await runWorkflow(makeInput(), deps).catch(
        (error: unknown) => error,
      );

      expect(caught).toBeInstanceOf(WorkflowError);
      expect((caught as WorkflowError).retryable).toBe(true);
      expect(caught).not.toBeInstanceOf(UnrecoverableError);
    });

    it('should stop the loop at the failing step', async () => {
      (mocks.handlers[GENERATE] as jest.Mock).mockRejectedValue(
        transient('blip'),
      );

      await runWorkflow(makeInput(), deps).catch(() => undefined);

      expect(mocks.handlers[PERSIST_VERSION]).not.toHaveBeenCalled();
    });
  });

  describe('completion', () => {
    it('should mark the run completed with the attempt total before emitting', async () => {
      Object.defineProperty(mocks.meter, 'creditsUsed', { value: 38 });

      await runWorkflow(makeInput(), deps);

      expect(mocks.run.complete).toHaveBeenCalledWith(38);
      // The run doc reaches COMPLETED before the client is told, so a client
      // that reacts to run.completed by re-reading the run never sees RUNNING.
      expect(mocks.run.complete.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.emitter.emit.mock.invocationCallOrder[
          mocks.emitter.emit.mock.calls.length - 1
        ],
      );
    });

    it('should not mark the run completed when a step fails', async () => {
      (mocks.handlers[GENERATE] as jest.Mock).mockRejectedValue(
        transient('blip'),
      );

      await runWorkflow(makeInput(), deps).catch(() => undefined);

      expect(mocks.run.complete).not.toHaveBeenCalled();
    });
  });
});

describe('handleTerminalFailure', () => {
  const artifactId = '665f1b2c3d4e5f6a7b8c9d02';

  const makeDeps = () => {
    const emitter = {
      emit: jest.fn(),
      flush: jest.fn().mockResolvedValue(undefined),
    };
    const artifacts = { failVersion: jest.fn().mockResolvedValue(undefined) };
    const run = { fail: jest.fn().mockResolvedValue(undefined) };
    const meter = { commit: jest.fn() };
    const logger = { error: jest.fn(), warn: jest.fn() };

    return {
      deps: { artifacts, run, emitter, logger } as any,
      mocks: { emitter, artifacts, run, meter, logger },
    };
  };

  let deps: ReturnType<typeof makeDeps>['deps'];
  let mocks: ReturnType<typeof makeDeps>['mocks'];

  beforeEach(() => {
    jest.clearAllMocks();
    ({ deps, mocks } = makeDeps());
  });

  const failure = { artifactId, version: 2, failureReason: 'zod invalid' };

  it('should mark the target version FAILED with the reason', async () => {
    await handleTerminalFailure(deps, failure);

    expect(mocks.artifacts.failVersion).toHaveBeenCalledWith(
      artifactId,
      2,
      'zod invalid',
    );
  });

  it('should mark the run FAILED with the reason', async () => {
    await handleTerminalFailure(deps, failure);

    expect(mocks.run.fail).toHaveBeenCalledWith('zod invalid');
  });

  it('should emit run.failed with the reason', async () => {
    await handleTerminalFailure(deps, failure);

    expect(mocks.emitter.emit).toHaveBeenCalledWith({
      type: RunEventType.RUN_FAILED,
      data: { failureReason: 'zod invalid' },
    });
  });

  it('should never commit credits — a failed run is not charged', async () => {
    await handleTerminalFailure(deps, failure);

    expect(mocks.meter.commit).not.toHaveBeenCalled();
  });

  it('should flush the emitter so run.failed reaches the stream', async () => {
    await handleTerminalFailure(deps, failure);

    expect(mocks.emitter.flush).toHaveBeenCalled();
  });

  it('should still fail the run when marking the version fails', async () => {
    // The handler is the last line of defence; one broken write must not strand
    // the run in RUNNING forever.
    mocks.artifacts.failVersion.mockRejectedValue(new Error('mongo down'));

    await expect(handleTerminalFailure(deps, failure)).resolves.toBeUndefined();

    expect(mocks.run.fail).toHaveBeenCalled();
    expect(mocks.logger.error).toHaveBeenCalled();
  });

  it('should still emit run.failed when marking the run fails', async () => {
    mocks.run.fail.mockRejectedValue(new Error('mongo down'));

    await expect(handleTerminalFailure(deps, failure)).resolves.toBeUndefined();

    expect(mocks.emitter.emit).toHaveBeenCalledWith({
      type: RunEventType.RUN_FAILED,
      data: { failureReason: 'zod invalid' },
    });
  });
});
