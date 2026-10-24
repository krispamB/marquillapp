import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';

// The builder reads these enums at load; the real barrel drags in Mongoose.
jest.mock(
  '../../database/schemas',
  () => ({
    ArtifactType: { POST: 'POST', POLL: 'POLL', DOCUMENT: 'DOCUMENT' },
    RunKind: { INITIAL: 'INITIAL', REFINE: 'REFINE' },
    VersionStatus: {
      GENERATING: 'GENERATING',
      READY: 'READY',
      FAILED: 'FAILED',
    },
    // For the real gate in the gating-read count.
    SubscriptionStatus: { ACTIVE: 'ACTIVE', PAST_DUE: 'PAST_DUE' },
    Subscription: class Subscription {},
    Tier: class Tier {},
    Usage: class Usage {},
    Artifact: class Artifact {},
  }),
  { virtual: true },
);

import { ContentValidationError } from '../../agent/agent-runner.error';
import { Types } from 'mongoose';
import { CreditMeterService } from '../../feature-gating/credit-meter.service';
import { FeatureGateForbiddenException } from '../../feature-gating/feature-gating.exception';
import {
  FeatureGatingService,
  type Entitlement,
} from '../../feature-gating/feature-gating.service';
import { WorkflowError, withFailureCode } from '../engine/workflow.error';
import { FailureCode } from '../workflow.constants';
import type { BuildInput } from '../engine/workflow.types';
import {
  ArtifactRunProcessor,
  isTerminalJobFailure,
} from './artifact-run.worker.handler';
import { STALLED_FAILURE_REASON } from './stalled-failure';

// These POST-run tests never reach RENDER_PDF, so never-called stubs suffice.
// The DOCUMENT pipeline runs through this processor in
// `document-generation.integration.spec.ts`.
const stubRenderer = { render: jest.fn() };
const stubDesignSystems = { resolve: jest.fn() };
const stubObjects = { put: jest.fn() };

const buildInput = (overrides: Partial<BuildInput> = {}): BuildInput =>
  ({
    type: 'POST',
    kind: 'INITIAL',
    withResearch: false,
    prompt: 'Why staff engineers should write more',
    userId: 'user-1',
    artifactId: 'artifact-1',
    version: 1,
    ...overrides,
  }) as unknown as BuildInput;

const makeJob = (overrides: Partial<Job<BuildInput>> = {}): Job<BuildInput> =>
  ({
    id: 'run-1',
    data: buildInput(),
    attemptsMade: 1,
    opts: { attempts: 3 },
    ...overrides,
  }) as unknown as Job<BuildInput>;

const ENTITLEMENT: Entitlement = {
  tier: null,
  source: 'subscription',
  subscriptionStatus: null,
  period: {
    periodStart: new Date('2026-03-14T00:00:00.000Z'),
    periodEnd: new Date('2026-04-14T00:00:00.000Z'),
  },
};

const makeProcessor = () => {
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;

  // The emitter's whole contract, so its ordering and TTL behaviour stay under
  // its own spec and this one only asserts that events reach Redis at all.
  const redis = {
    xadd: jest.fn().mockResolvedValue('1-0'),
    expire: jest.fn().mockResolvedValue(1),
  };

  const agent = {
    generate: jest.fn().mockResolvedValue({
      title: 'Writing more',
      content: { commentary: 'Write more.' },
    }),
    research: jest.fn(),
  };
  const artifacts = {
    readVersion: jest.fn().mockResolvedValue({ status: 'GENERATING' }),
    readRefineInput: jest.fn(),
    promoteVersion: jest.fn().mockResolvedValue(undefined),
    failVersion: jest.fn().mockResolvedValue('FAILED'),
  };
  const runHandle = {
    runId: 'run-1',
    saveResearchContext: jest.fn().mockResolvedValue(undefined),
    readResearchContext: jest.fn().mockResolvedValue(undefined),
    recordRenderAttempt: jest.fn().mockResolvedValue(undefined),
    recordDocumentCheck: jest.fn().mockResolvedValue(undefined),
    getLatestCompletedResearch: jest.fn(),
    readAcceptedCandidateText: jest.fn(),
    complete: jest.fn().mockResolvedValue(undefined),
    fail: jest.fn().mockResolvedValue(undefined),
    readAcceptedCandidate: jest.fn().mockResolvedValue(undefined),
    readDocumentDiagnostics: jest.fn().mockResolvedValue(undefined),
    saveDocumentDiagnostics: jest.fn().mockResolvedValue(undefined),
    recordQueueWait: jest.fn().mockResolvedValue(undefined),
    recordModelCall: jest.fn(),
  };
  const runs = { handleFor: jest.fn().mockReturnValue(runHandle) };
  const inflight = {
    refresh: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const creditMeter = {
    assertBalance: jest.fn().mockResolvedValue(undefined),
    toCredits: jest.fn().mockReturnValue(20),
    debit: jest.fn().mockResolvedValue(undefined),
  };
  const featureGating = {
    resolveEntitlement: jest.fn().mockResolvedValue(ENTITLEMENT),
    assertResearchAccess: jest.fn().mockResolvedValue(undefined),
  };

  const processor = new ArtifactRunProcessor({
    agent: agent as any,
    artifacts: artifacts as any,
    designSystems: stubDesignSystems as never,
    renderer: stubRenderer as any,
    fonts: { inlineCss: jest.fn().mockResolvedValue(null) },
    objects: stubObjects as never,
    creditMeter: creditMeter as any,
    featureGating: featureGating as any,
    runs: runs as any,
    inflight,
    redis: redis as any,
    logger,
  });

  return {
    processor,
    mocks: {
      logger,
      redis,
      agent,
      artifacts,
      runs,
      runHandle,
      inflight,
      creditMeter,
      featureGating,
    },
  };
};

/** The `event` field of each `XADD` this run wrote, in emission order. */
const emittedTypes = (redis: { xadd: jest.Mock }): string[] =>
  redis.xadd.mock.calls.map((call) => call[6] as string);

const emittedSeqs = (redis: { xadd: jest.Mock }): number[] =>
  redis.xadd.mock.calls.map(
    (call) => (JSON.parse(call[8] as string) as { seq: number }).seq,
  );

const emittedData = (redis: { xadd: jest.Mock }): Record<string, unknown>[] =>
  redis.xadd.mock.calls.map(
    (call) => JSON.parse(call[8] as string) as Record<string, unknown>,
  );

let processor: ArtifactRunProcessor;
let mocks: ReturnType<typeof makeProcessor>['mocks'];

beforeEach(() => {
  jest.clearAllMocks();
  ({ processor, mocks } = makeProcessor());
});

describe('isTerminalJobFailure', () => {
  it('should be terminal for an UnrecoverableError even with attempts remaining', () => {
    const job = makeJob({ attemptsMade: 1 });
    expect(isTerminalJobFailure(job, new UnrecoverableError('bad'))).toBe(true);
  });

  it('should be terminal when the attempt budget is exhausted', () => {
    const job = makeJob({ attemptsMade: 3 });
    expect(isTerminalJobFailure(job, new Error('transient'))).toBe(true);
  });

  it('should not be terminal for a transient failure with attempts remaining', () => {
    const job = makeJob({ attemptsMade: 1 });
    expect(isTerminalJobFailure(job, new Error('transient'))).toBe(false);
  });

  it('should treat a single-attempt job as exhausted on its first failure', () => {
    const job = makeJob({ attemptsMade: 1, opts: {} as Job['opts'] });
    expect(isTerminalJobFailure(job, new Error('transient'))).toBe(true);
  });
});

describe('ArtifactRunProcessor', () => {
  describe('process', () => {
    it('should terminally reject a disallowed research job before Tavily can run', async () => {
      mocks.featureGating.assertResearchAccess.mockRejectedValue(
        new FeatureGateForbiddenException({
          code: 'FEATURE_LIMIT_EXCEEDED',
          feature: 'research',
          limit: 0,
          currentUsage: 0,
          tier: { id: 'tier-1', name: 'Free' },
          upgradeHint: 'Upgrade your plan to use AI research.',
        }),
      );
      const job = makeJob({ data: buildInput({ withResearch: true }) });

      await expect(processor.process(job)).rejects.toBeInstanceOf(
        UnrecoverableError,
      );

      expect(mocks.agent.research).not.toHaveBeenCalled();
      expect(mocks.agent.generate).not.toHaveBeenCalled();
      expect(mocks.creditMeter.assertBalance).not.toHaveBeenCalled();
    });

    it('should preserve retryable entitlement failures instead of claiming research is disallowed', async () => {
      const outage = new Error('database unavailable');
      mocks.featureGating.assertResearchAccess.mockRejectedValue(outage);
      const job = makeJob({ data: buildInput({ withResearch: true }) });

      await expect(processor.process(job)).rejects.toBe(outage);

      expect(mocks.agent.research).not.toHaveBeenCalled();
    });

    it('should allow a paid research job through the worker capability check', async () => {
      mocks.agent.research.mockResolvedValue({
        findings: 'Found',
        sources: [],
      });
      const job = makeJob({ data: buildInput({ withResearch: true }) });

      await processor.process(job);

      expect(mocks.featureGating.assertResearchAccess).toHaveBeenCalledWith(
        'user-1',
        ENTITLEMENT,
      );
      expect(mocks.agent.research).toHaveBeenCalledTimes(1);
    });

    it('should resolve the entitlement once and reuse it when running the research check, balance check and debit', async () => {
      mocks.agent.research.mockResolvedValue({
        findings: 'Found',
        sources: [],
      });
      mocks.agent.generate.mockImplementation(
        (_input: unknown, hooks: { onUsage: (usage: object) => void }) => {
          hooks.onUsage({ totalTokens: 15, cost: 0.02, model: 'm' });
          return Promise.resolve({
            title: 'Writing more',
            content: { commentary: 'Write more.' },
          });
        },
      );

      await processor.process(
        makeJob({ data: buildInput({ withResearch: true }) }),
      );

      expect(mocks.featureGating.resolveEntitlement).toHaveBeenCalledTimes(1);
      expect(mocks.featureGating.resolveEntitlement).toHaveBeenCalledWith(
        'user-1',
      );
      expect(mocks.creditMeter.assertBalance).toHaveBeenCalledWith(
        'user-1',
        ENTITLEMENT,
      );
      expect(mocks.creditMeter.debit).toHaveBeenCalledWith(
        'user-1',
        expect.any(Number),
        ENTITLEMENT.period,
      );
    });

    it('should leave the job to retry, having run nothing, when the entitlement cannot be resolved', async () => {
      const outage = new Error('database unavailable');
      mocks.featureGating.resolveEntitlement.mockRejectedValue(outage);

      await expect(processor.process(makeJob())).rejects.toBe(outage);

      expect(mocks.creditMeter.assertBalance).not.toHaveBeenCalled();
      expect(mocks.agent.generate).not.toHaveBeenCalled();
    });

    it('should leave non-research worker behavior outside the capability gate', async () => {
      await processor.process(makeJob());

      expect(mocks.featureGating.assertResearchAccess).not.toHaveBeenCalled();
    });

    it('should stop immediately when the worker confirms exhausted credits', async () => {
      mocks.creditMeter.assertBalance.mockRejectedValue(
        new FeatureGateForbiddenException({
          code: 'FEATURE_LIMIT_EXCEEDED',
          feature: 'credits',
          limit: 120,
          currentUsage: 120,
          tier: { id: 'tier-1', name: 'Free' },
          upgradeHint: 'You have used all your credits for this period.',
        }),
      );

      await expect(processor.process(makeJob())).rejects.toMatchObject({
        name: 'UnrecoverableError',
        message: 'insufficient credits',
      });
      expect(mocks.agent.generate).not.toHaveBeenCalled();
    });

    it('should retry a database failure during the worker balance check', async () => {
      mocks.creditMeter.assertBalance.mockRejectedValue(
        new Error("Socket 'secureConnect' timed out"),
      );

      const error: unknown = await processor
        .process(makeJob())
        .catch((cause: unknown): unknown => cause);

      expect(error).toBeInstanceOf(WorkflowError);
      expect(error).toMatchObject({
        reason: "Socket 'secureConnect' timed out",
        retryable: true,
      });
      expect(mocks.agent.generate).not.toHaveBeenCalled();
    });

    it('should run a research-off POST job to a READY version', async () => {
      await processor.process(makeJob());

      expect(mocks.artifacts.promoteVersion).toHaveBeenCalledWith(
        'artifact-1',
        1,
        { commentary: 'Write more.' },
        { title: 'Writing more' },
      );
      expect(mocks.runHandle.complete).toHaveBeenCalledTimes(1);
      expect(mocks.artifacts.failVersion).not.toHaveBeenCalled();
    });

    it("should refresh the run's in-flight lease at the start of each attempt", async () => {
      await processor.process(makeJob());

      expect(mocks.inflight.refresh).toHaveBeenCalledWith('user-1', 'run-1');
    });

    it('should release the in-flight slot when the run succeeds', async () => {
      await processor.process(makeJob());

      expect(mocks.inflight.release).toHaveBeenCalledWith('user-1', 'run-1');
    });

    it('should keep the in-flight slot when an attempt fails and will be retried', async () => {
      mocks.agent.generate.mockRejectedValue(new Error('transient'));

      await expect(processor.process(makeJob())).rejects.toThrow('transient');

      expect(mocks.inflight.release).not.toHaveBeenCalled();
    });

    it('should record how long the job waited in the queue when its first attempt is picked up', async () => {
      await processor.process(
        makeJob({
          attemptsMade: 0,
          attemptsStarted: 1,
          timestamp: 1_000,
          processedOn: 5_200,
        }),
      );

      expect(mocks.runHandle.recordQueueWait).toHaveBeenCalledWith(4_200);
    });

    it('should not record a queue wait for a retried job attempt, whose wait includes the earlier attempts', async () => {
      await processor.process(
        makeJob({
          attemptsMade: 1,
          attemptsStarted: 2,
          timestamp: 1_000,
          processedOn: 90_000,
        }),
      );

      expect(mocks.runHandle.recordQueueWait).not.toHaveBeenCalled();
    });

    it('should not record a queue wait for a stalled job restarted without a failed attempt', async () => {
      await processor.process(
        makeJob({
          attemptsMade: 0,
          attemptsStarted: 2,
          timestamp: 1_000,
          processedOn: 90_000,
        }),
      );

      expect(mocks.runHandle.recordQueueWait).not.toHaveBeenCalled();
    });

    it('should still run the job when the queue wait cannot be recorded', async () => {
      mocks.runHandle.recordQueueWait.mockRejectedValue(
        new Error('mongo down'),
      );

      await processor.process(
        makeJob({
          attemptsMade: 0,
          attemptsStarted: 1,
          timestamp: 1_000,
          processedOn: 5_200,
        }),
      );

      expect(mocks.runHandle.complete).toHaveBeenCalledTimes(1);
    });

    it('should emit the honest three-step lifecycle', async () => {
      await processor.process(makeJob());

      expect(emittedTypes(mocks.redis)).toEqual([
        'run.started',
        'step.started',
        'step.completed',
        'step.started',
        'step.completed',
        'step.started',
        'step.completed',
        'run.completed',
      ]);
    });

    it('should refine from cached research without running the RESEARCH step when processing a REFINE job', async () => {
      const research = {
        findings: 'Cached findings',
        sources: [{ title: 'Source', url: 'https://example.com' }],
      };
      mocks.artifacts.readRefineInput.mockResolvedValue({
        priorContent: { commentary: 'The original post.' },
        feedback: 'Make the hook sharper',
      });
      mocks.runHandle.getLatestCompletedResearch.mockResolvedValue(research);
      const job = makeJob({
        data: buildInput({ kind: 'REFINE', withResearch: true, version: 2 }),
      });

      await processor.process(job);

      expect(mocks.agent.research).not.toHaveBeenCalled();
      expect(mocks.agent.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          research,
          refine: {
            priorContent: { commentary: 'The original post.' },
            feedback: 'Make the hook sharper',
          },
        }),
        expect.any(Object),
      );
      const runStarted = mocks.redis.xadd.mock.calls.find(
        (call) => call[6] === 'run.started',
      );
      expect(JSON.parse(runStarted[8]).steps).toEqual([
        'RESOLVE_INPUT',
        'GENERATE',
        'PERSIST_VERSION',
      ]);
      expect(emittedTypes(mocks.redis)).toEqual([
        'run.started',
        'step.started',
        'step.completed',
        'step.started',
        'step.completed',
        'step.started',
        'step.completed',
        'run.completed',
      ]);
    });

    it('should meter the LLM turn and commit the credits once', async () => {
      mocks.agent.generate.mockImplementation((_input, hooks) => {
        hooks.onUsage({
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
          cost: 0.02,
          model: 'test/generation-model',
        });
        return Promise.resolve({
          title: 'Writing more',
          content: { commentary: 'Write more.' },
        });
      });

      await processor.process(makeJob());

      expect(mocks.creditMeter.toCredits).toHaveBeenCalledWith({
        kind: 'llm',
        amount: 0.02,
        detail: { model: 'test/generation-model', totalTokens: 15 },
      });
      expect(mocks.creditMeter.debit).toHaveBeenCalledTimes(1);
      expect(mocks.creditMeter.debit).toHaveBeenCalledWith(
        'user-1',
        20,
        ENTITLEMENT.period,
      );
      expect(mocks.runHandle.complete).toHaveBeenCalledWith(20);
    });

    it('should include one successful research lookup in live usage and final settlement exactly once', async () => {
      mocks.creditMeter.toCredits.mockImplementation((usage) =>
        usage.kind === 'web_search' ? 32 : 20,
      );
      mocks.agent.research.mockImplementation((_input, hooks) => {
        hooks.onUsage({
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
          cost: 0.01,
          model: 'test/research-model',
        });
        hooks.onToolCall({ name: 'searchWeb' });
        return Promise.resolve({ findings: 'Found', sources: [] });
      });

      await processor.process(
        makeJob({ data: buildInput({ withResearch: true }) }),
      );

      expect(mocks.creditMeter.toCredits).toHaveBeenCalledWith({
        kind: 'web_search',
        amount: 1,
      });
      expect(mocks.creditMeter.toCredits).toHaveBeenCalledTimes(2);
      expect(mocks.runHandle.complete).toHaveBeenCalledWith(52);
      expect(mocks.creditMeter.debit).toHaveBeenCalledWith(
        'user-1',
        52,
        ENTITLEMENT.period,
      );
      const usageTicks = mocks.redis.xadd.mock.calls
        .filter((call) => call[6] === 'usage.tick')
        .map((call) => JSON.parse(call[8] as string));
      expect(usageTicks).toEqual([
        expect.objectContaining({ credits: 20, totalCredits: 20 }),
        expect.objectContaining({ credits: 32, totalCredits: 52 }),
      ]);
    });

    it('should exclude a failed research lookup from live usage and final settlement', async () => {
      mocks.agent.research.mockImplementation((_input, hooks) => {
        hooks.onUsage({
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
          cost: 0.01,
          model: 'test/research-model',
        });
        // AgentRunner absorbs the failed Tavily result and deliberately does
        // not invoke onToolCall.
        return Promise.resolve({ findings: 'Adapted', sources: [] });
      });

      await processor.process(
        makeJob({ data: buildInput({ withResearch: true }) }),
      );

      expect(mocks.creditMeter.toCredits).not.toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'web_search' }),
      );
      expect(mocks.runHandle.complete).toHaveBeenCalledWith(20);
      expect(mocks.creditMeter.debit).toHaveBeenCalledWith(
        'user-1',
        20,
        ENTITLEMENT.period,
      );
      expect(
        mocks.redis.xadd.mock.calls.filter((call) => call[6] === 'usage.tick'),
      ).toHaveLength(1);
    });

    it('should reject a job with no id, since events have nothing to key on', async () => {
      await expect(
        processor.process(makeJob({ id: undefined })),
      ).rejects.toBeInstanceOf(UnrecoverableError);
    });
  });

  describe('gating reads', () => {
    /**
     * The real gate and meter service over counting model mocks: one
     * `findOne`/`findById` is one database read. The worker process is long
     * lived, so its tier cache is warm after the first job.
     */
    const makeGatedProcessor = () => {
      const paidTier = {
        _id: new Types.ObjectId(),
        name: 'Starter',
        monthlyPrice: 9.99,
        limits: { credits: 1000, research: 1 },
      };
      const subscriptionModel = {
        findOne: jest.fn(() => ({
          sort: () => ({
            lean: () =>
              Promise.resolve({
                status: 'ACTIVE',
                tierId: paidTier._id,
                currentPeriodStart: new Date(Date.now() - 86_400_000),
                currentPeriodEnd: new Date(Date.now() + 86_400_000),
              }),
          }),
        })),
      };
      const tierModel = {
        findById: jest.fn(() => ({ lean: () => Promise.resolve(paidTier) })),
        findOne: jest.fn(),
      };
      const usageModel = {
        findOne: jest.fn(() => ({ lean: () => Promise.resolve({ count: 1 }) })),
        updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
      };
      const featureGating = new FeatureGatingService(
        subscriptionModel as never,
        tierModel as never,
        usageModel as never,
        {} as never,
        {} as never,
        {} as never,
      );
      const creditMeter = new CreditMeterService(
        { get: () => undefined } as never,
        featureGating,
      );
      const { mocks } = makeProcessor();
      mocks.agent.research.mockResolvedValue({
        findings: 'Found',
        sources: [],
      });
      mocks.agent.generate.mockImplementation(
        (_input: unknown, hooks: { onUsage: (usage: object) => void }) => {
          hooks.onUsage({ totalTokens: 15, cost: 0.02, model: 'm' });
          return Promise.resolve({
            title: 'Writing more',
            content: { commentary: 'Write more.' },
          });
        },
      );
      const gated = new ArtifactRunProcessor({
        agent: mocks.agent as never,
        artifacts: mocks.artifacts as never,
        designSystems: stubDesignSystems as never,
        renderer: stubRenderer as never,
        fonts: { inlineCss: jest.fn().mockResolvedValue(null) },
        objects: stubObjects as never,
        creditMeter,
        featureGating,
        runs: mocks.runs as never,
        inflight: mocks.inflight,
        redis: mocks.redis as never,
        logger: mocks.logger,
      });
      const reads = () =>
        subscriptionModel.findOne.mock.calls.length +
        tierModel.findById.mock.calls.length +
        tierModel.findOne.mock.calls.length +
        usageModel.findOne.mock.calls.length;
      return { gated, subscriptionModel, tierModel, usageModel, reads };
    };

    const researchJob = () =>
      makeJob({
        data: buildInput({
          userId: new Types.ObjectId().toString(),
          withResearch: true,
        }),
      });

    it('should make 2 gating reads for a research job when the tier is cached', async () => {
      const run = makeGatedProcessor();
      await run.gated.process(researchJob());
      const before = run.reads();

      await run.gated.process(researchJob());

      expect(run.reads() - before).toBe(2);
    });

    it('should read the subscription and usage once each, and the tier once when cold', async () => {
      const run = makeGatedProcessor();

      await run.gated.process(researchJob());

      expect(run.subscriptionModel.findOne).toHaveBeenCalledTimes(1);
      expect(run.tierModel.findById).toHaveBeenCalledTimes(1);
      // The balance check, kept because the wallet can drain while the job
      // waits; the debit writes into the resolved period without a read.
      expect(run.usageModel.findOne).toHaveBeenCalledTimes(1);
      expect(run.usageModel.updateOne).toHaveBeenCalledTimes(1);
    });
  });

  describe('onFailed', () => {
    it('should mark the version and run FAILED on a terminal failure', async () => {
      const job = makeJob();
      const error = new UnrecoverableError('commentary must not be empty');

      await processor.onFailed(job, error);

      expect(mocks.artifacts.failVersion).toHaveBeenCalledWith(
        'artifact-1',
        1,
        'internal',
        'commentary must not be empty',
      );
      expect(mocks.runHandle.fail).toHaveBeenCalledWith(
        'internal',
        'commentary must not be empty',
      );
      expect(emittedTypes(mocks.redis)).toEqual(['run.failed']);
      expect(emittedData(mocks.redis)[0]).toMatchObject({
        code: 'internal',
        failureReason: 'commentary must not be empty',
      });
    });

    it('should release the in-flight slot on a terminal failure', async () => {
      await processor.onFailed(
        makeJob(),
        new UnrecoverableError('commentary must not be empty'),
      );

      expect(mocks.inflight.release).toHaveBeenCalledWith('user-1', 'run-1');
    });

    it('should release the in-flight slot when the job stalled out', async () => {
      await processor.onFailed(
        makeJob(),
        new UnrecoverableError(STALLED_FAILURE_REASON),
      );

      expect(mocks.inflight.release).toHaveBeenCalledWith('user-1', 'run-1');
    });

    it('should release the in-flight slot even when the run had already ended', async () => {
      mocks.runHandle.fail.mockResolvedValue('ALREADY_ENDED');

      await processor.onFailed(
        makeJob(),
        new UnrecoverableError(STALLED_FAILURE_REASON),
      );

      expect(mocks.inflight.release).toHaveBeenCalledWith('user-1', 'run-1');
    });

    it('should release the in-flight slot when the version cannot be marked FAILED', async () => {
      mocks.artifacts.failVersion.mockRejectedValue(new Error('mongo down'));

      await processor.onFailed(makeJob(), new UnrecoverableError('boom'));

      expect(mocks.inflight.release).toHaveBeenCalledWith('user-1', 'run-1');
    });

    it('should keep the in-flight slot when the attempt will be retried', async () => {
      await processor.onFailed(
        makeJob({ attemptsMade: 1 }),
        new Error('flaky'),
      );

      expect(mocks.inflight.release).not.toHaveBeenCalled();
    });

    it("should fail the run through the job attempt's own handle, which holds its LLM usage", async () => {
      const handles: Array<typeof mocks.runHandle> = [];
      mocks.runs.handleFor.mockImplementation(() => {
        const handle = { ...mocks.runHandle, fail: jest.fn() };
        handles.push(handle);
        return handle;
      });
      const error = new UnrecoverableError('commentary must not be empty');
      mocks.agent.generate.mockRejectedValue(error);
      const job = makeJob();

      await expect(processor.process(job)).rejects.toThrow();
      await processor.onFailed(job, error);

      expect(handles[0].fail).toHaveBeenCalledTimes(1);
      expect(
        handles.slice(1).every((handle) => !handle.fail.mock.calls.length),
      ).toBe(true);
    });

    it('should record no document diagnostics and log no completion line for a POST run', async () => {
      await processor.process(makeJob());
      await processor.onFailed(makeJob(), new UnrecoverableError('nope'));

      expect(mocks.runHandle.saveDocumentDiagnostics).not.toHaveBeenCalled();
      expect(
        (mocks.logger.log as jest.Mock).mock.calls.filter(([line]) =>
          String(line).startsWith('[DOCUMENT_RUN]'),
        ),
      ).toEqual([]);
    });

    it('should emit run.failed once when the same terminal failure is reported twice', async () => {
      mocks.runHandle.fail
        .mockResolvedValueOnce('FAILED')
        .mockResolvedValue('ALREADY_ENDED');
      const job = makeJob();
      const error = new UnrecoverableError(STALLED_FAILURE_REASON);

      await Promise.all([
        processor.onFailed(job, error),
        processor.onFailed(job, error),
      ]);

      expect(emittedTypes(mocks.redis)).toEqual(['run.failed']);
    });

    it('should give the user the temporary-failure reason when the job stalled out', async () => {
      await processor.onFailed(
        makeJob(),
        new UnrecoverableError(STALLED_FAILURE_REASON),
      );

      expect(mocks.runHandle.fail).toHaveBeenCalledWith(
        'internal',
        'Generation is temporarily unavailable. Please try again.',
      );
    });

    describe('for a DOCUMENT run', () => {
      const documentJob = (attemptsMade: number) =>
        makeJob({
          attemptsMade,
          data: buildInput({
            type: 'DOCUMENT',
            designSystem: { id: 'margin', version: 2 },
          } as Partial<BuildInput>),
        });
      const secret = new UnrecoverableError(
        'failed validation: Unexpected token in "<section>SECRET</section>"',
      );
      const logged = () =>
        JSON.stringify([
          (mocks.logger.log as jest.Mock).mock.calls,
          (mocks.logger.warn as jest.Mock).mock.calls,
          (mocks.logger.error as jest.Mock).mock.calls,
        ]);

      it('should log the code, not the error text, when the run fails terminally', async () => {
        await processor.onFailed(documentJob(1), secret);

        expect(mocks.logger.error).toHaveBeenCalledWith(
          'Artifact run run-1 failed terminally: internal',
        );
        expect(logged()).not.toContain('SECRET');
        expect(mocks.runHandle.saveDocumentDiagnostics).toHaveBeenCalledWith(
          expect.objectContaining({
            jobAttemptFailures: [
              {
                jobAttempt: 1,
                failureCode: 'internal',
                message: secret.message,
              },
            ],
          }),
          undefined,
        );
      });

      it('should record no second set of diagnostics when the run had already ended', async () => {
        mocks.runHandle.fail.mockResolvedValue('ALREADY_ENDED');

        await processor.onFailed(documentJob(1), secret);

        expect(mocks.runHandle.saveDocumentDiagnostics).not.toHaveBeenCalled();
      });

      it('should log the code, not the error text, when the job attempt will be retried', async () => {
        await processor.onFailed(
          documentJob(1),
          new Error('timed out reading "<section>SECRET</section>"'),
        );

        expect(mocks.logger.warn).toHaveBeenCalledWith(
          'Artifact run run-1 failed (attempt 1/3); retrying: internal',
        );
        expect(logged()).not.toContain('SECRET');
        expect(mocks.runHandle.saveDocumentDiagnostics).toHaveBeenCalledWith(
          expect.objectContaining({ outcome: 'RETRYING' }),
          undefined,
        );
      });

      it('should carry on what earlier job attempts recorded, and the checkpoint, when the job attempt ran in another process', async () => {
        mocks.runHandle.readDocumentDiagnostics.mockResolvedValue({
          jobAttempt: 1,
          outcome: 'RETRYING',
          jobAttemptFailures: [
            { jobAttempt: 1, failureCode: 'render.unavailable', message: 'm' },
          ],
          candidates: [],
          repairRounds: 0,
          outputTokens: 6000,
          stepWallTimeMs: {},
          wallTimeMs: 90_000,
          renderAttempts: { sessions: 2 },
          credits: 180,
          recordedAt: new Date(),
        });
        mocks.runHandle.readAcceptedCandidate.mockResolvedValue({
          commentary: 'c',
          candidate: '<section class="page"></section>',
          repairsSpent: 0,
          savedAt: new Date(),
        });

        await processor.onFailed(documentJob(3), new Error('stalled'));

        const [diagnostics, failedCandidateSource] = mocks.runHandle
          .saveDocumentDiagnostics.mock.calls[0] as [
          Record<string, unknown>,
          string,
        ];
        expect(diagnostics).toMatchObject({
          jobAttempt: 3,
          pin: { id: 'margin', version: 2 },
          outcome: 'FAILED',
          failureCode: 'internal',
          outputTokens: 6000,
          renderAttempts: { sessions: 2 },
          credits: 0,
        });
        expect(diagnostics.wallTimeMs).toBeGreaterThanOrEqual(90_000);
        expect(failedCandidateSource).toBe('<section class="page"></section>');
        expect(mocks.logger.log).toHaveBeenCalledWith(
          expect.stringMatching(/^\[DOCUMENT_RUN\] \{"runId":"run-1",/),
        );
      });
    });

    it('should never commit credits for a failed run', async () => {
      await processor.onFailed(makeJob(), new UnrecoverableError('nope'));

      expect(mocks.creditMeter.debit).not.toHaveBeenCalled();
    });

    it('should continue the run seq rather than restart it, when the attempt ran here', async () => {
      mocks.agent.generate.mockRejectedValue(
        new ContentValidationError('commentary must not be empty'),
      );
      const job = makeJob();

      const error = await processor.process(job).catch((e: Error) => e);
      await processor.onFailed(job, error as Error);

      expect(emittedTypes(mocks.redis)).toEqual([
        'run.started',
        'step.started',
        'step.completed',
        'step.started',
        'step.failed',
        'run.failed',
      ]);
      expect(emittedSeqs(mocks.redis)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('should leave the version GENERATING when the attempt will be retried', async () => {
      const job = makeJob({ attemptsMade: 1 });

      await processor.onFailed(job, new Error('gateway timeout'));

      expect(mocks.artifacts.failVersion).not.toHaveBeenCalled();
      expect(mocks.runHandle.fail).not.toHaveBeenCalled();
      expect(mocks.redis.xadd).not.toHaveBeenCalled();
    });

    it('should hide an exhausted transient cause from the artifact client', async () => {
      await processor.onFailed(
        makeJob({ attemptsMade: 3 }),
        new Error("Socket 'secureConnect' timed out"),
      );

      expect(mocks.artifacts.failVersion).toHaveBeenCalledWith(
        'artifact-1',
        1,
        'internal',
        'Generation is temporarily unavailable. Please try again.',
      );
      expect(mocks.runHandle.fail).toHaveBeenCalledWith(
        'internal',
        'Generation is temporarily unavailable. Please try again.',
      );
      expect(emittedTypes(mocks.redis)).toEqual(['run.failed']);
      expect(mocks.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Socket 'secureConnect' timed out"),
      );
    });

    it("should fail with the code the error carries and that code's client reason", async () => {
      const error = withFailureCode(
        new UnrecoverableError('3 static violation(s), and there is no Repair'),
        FailureCode.DOCUMENT_REPAIR_EXHAUSTED,
      );

      await processor.onFailed(makeJob(), error);

      const reason =
        "We couldn't get this design to fit cleanly. Try refining with a shorter brief or another design.";
      expect(mocks.artifacts.failVersion).toHaveBeenCalledWith(
        'artifact-1',
        1,
        'document.repair_exhausted',
        reason,
      );
      expect(mocks.runHandle.fail).toHaveBeenCalledWith(
        'document.repair_exhausted',
        reason,
      );
      expect(emittedData(mocks.redis)[0]).toMatchObject({
        code: 'document.repair_exhausted',
        failureReason: reason,
      });
    });

    it('should keep a transient code when the attempt budget is exhausted', async () => {
      const error = withFailureCode(
        new WorkflowError('socket hang up', { retryable: true }),
        FailureCode.RENDER_UNAVAILABLE,
      );

      await processor.onFailed(makeJob({ attemptsMade: 3 }), error);

      expect(mocks.runHandle.fail).toHaveBeenCalledWith(
        'render.unavailable',
        "We couldn't render your document right now. Please try again.",
      );
    });

    it('should log and return when the job has no id', async () => {
      await processor.onFailed(
        makeJob({ id: undefined, attemptsMade: 3 }),
        new Error('boom'),
      );

      expect(mocks.runHandle.fail).not.toHaveBeenCalled();
      expect(mocks.logger.error).toHaveBeenCalled();
    });
  });

  describe('idle', () => {
    it('should resolve at once when no failure handler is in flight', async () => {
      await expect(processor.idle()).resolves.toBeUndefined();
    });

    it('should wait for an in-flight failure handler when one is running', async () => {
      let release!: () => void;
      mocks.runHandle.fail.mockReturnValue(
        new Promise<void>((resolve) => (release = resolve)),
      );
      let idle = false;

      const failed = processor.onFailed(
        makeJob(),
        new UnrecoverableError('nope'),
      );
      const waiting = processor.idle().then(() => (idle = true));
      for (let i = 0; i < 10; i++) await Promise.resolve();
      expect(idle).toBe(false);

      release();
      await failed;
      await waiting;
      expect(idle).toBe(true);
    });

    it('should resolve when an in-flight failure handler rejects', async () => {
      mocks.runs.handleFor.mockImplementation(() => {
        throw new Error('no handle');
      });

      const failed = expect(
        processor.onFailed(makeJob(), new UnrecoverableError('nope')),
      ).rejects.toThrow('no handle');

      await expect(processor.idle()).resolves.toBeUndefined();
      await failed;
    });
  });
});
