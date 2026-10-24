jest.mock('../../document-source/candidate-check', () => ({
  check: jest.fn(),
}));

import { ContentValidationError } from '../../agent/agent-runner.error';
import type { DesignSystemDefinition } from '../../design-system/design-system-definition';
import { check } from '../../document-source/candidate-check';
import type { Violation } from '../../document-source/violation';
import type { StepContext } from '../engine/workflow.types';
import { FailureCode, WorkflowStep } from '../workflow.constants';
import { repair, repairStatically, type RepairScope } from './document-repair';

const mockedCheck = check as jest.MockedFunction<typeof check>;

const CANDIDATE = '<!doctype html><html><body><p>13px</p></body></html>';
const PATCHED = '<!doctype html><html><body><p>14px</p></body></html>';
const REWRITTEN = '<!doctype html><html><body><p>rewritten</p></body></html>';
const EDIT = { find: '<p>13px</p>', replace: '<p>14px</p>' };
const MISSING_EDIT = { find: '<p>secret text</p>', replace: '<p>x</p>' };
const finding: Violation = {
  code: 'typography.rules.minPx',
  detail: 'font-size 13px is below 14px',
};

const makeScope = () => {
  const agent = {
    generate: jest.fn(),
    generateDocument: jest.fn(),
    repairDocument: jest
      .fn()
      .mockResolvedValue({ html: REWRITTEN, envelopeRepairs: 0 }),
    repairDocumentPatch: jest
      .fn()
      .mockResolvedValue({ edits: [EDIT], envelopeRepairs: 0 }),
    repairDocumentFallback: jest
      .fn()
      .mockResolvedValue({ html: REWRITTEN, envelopeRepairs: 0 }),
    research: jest.fn(),
  };
  const meter = { record: jest.fn() };
  const run = {
    runId: 'run-1',
    recordDocumentCheck: jest.fn().mockResolvedValue(undefined),
    recordModelCall: jest.fn(),
  };
  const emit = jest.fn();
  const deadline = {
    assertTimeLeft: jest.fn(),
    remainingMs: jest.fn(() => 120_000),
  };
  const diagnostics = {
    recordModelTurn: jest.fn(),
    recordCheck: jest.fn(),
    recordRepairsSpent: jest.fn(),
    recordRepair: jest.fn(),
  };
  const ctx = {
    agent,
    meter,
    run,
    emit,
    deadline,
    diagnostics,
  } as unknown as StepContext;
  const definition = {
    id: 'margin',
    version: 2,
  } as unknown as DesignSystemDefinition;
  const scope = (mode?: RepairScope['mode']): RepairScope => ({
    ctx,
    step: WorkflowStep.GENERATE,
    definition,
    fragment: 'FRAGMENT',
    includeTitle: true,
    label: 'artifact artifact-1 v1',
    ...(mode ? { mode } : {}),
  });

  return { scope, mocks: { agent, meter, run, deadline, diagnostics } };
};

let scope: ReturnType<typeof makeScope>['scope'];
let mocks: ReturnType<typeof makeScope>['mocks'];

beforeEach(() => {
  jest.clearAllMocks();
  ({ scope, mocks } = makeScope());
});

describe('document-repair', () => {
  describe('repair', () => {
    describe('in full mode', () => {
      it('should ask for the complete document and charge one round when the scope sets no mode', async () => {
        await expect(
          repair(
            scope(),
            { candidate: CANDIDATE, repairsSpent: 0 },
            [finding],
            'static',
          ),
        ).resolves.toEqual({ candidate: REWRITTEN, repairsSpent: 1 });

        expect(mocks.agent.repairDocument).toHaveBeenCalledTimes(1);
        expect(mocks.agent.repairDocument).toHaveBeenCalledWith(
          {
            fragment: 'FRAGMENT',
            includeTitle: true,
            candidate: CANDIDATE,
            violations: { violations: [finding], omitted: [] },
            maxEnvelopeRepairs: 1,
            sessionId: 'run-1',
            timeLeftMs: 120_000,
          },
          expect.anything(),
        );
        expect(mocks.agent.repairDocumentPatch).not.toHaveBeenCalled();
        expect(mocks.agent.repairDocumentFallback).not.toHaveBeenCalled();
        expect(mocks.diagnostics.recordRepairsSpent).toHaveBeenCalledWith(1);
      });

      it('should record a full-mode round with no edits and no fallback', async () => {
        await repair(
          scope('full'),
          { candidate: CANDIDATE, repairsSpent: 0 },
          [finding],
          'render',
        );

        expect(mocks.diagnostics.recordRepair).toHaveBeenCalledWith({
          kind: 'render',
          mode: 'full',
          edits: 0,
          fallback: false,
        });
      });
    });

    describe('in patch mode', () => {
      it('should apply the edits and return the patched candidate, charging one round', async () => {
        await expect(
          repair(
            scope('patch'),
            { candidate: CANDIDATE, repairsSpent: 0 },
            [finding],
            'static',
          ),
        ).resolves.toEqual({ candidate: PATCHED, repairsSpent: 1 });

        expect(mocks.agent.repairDocumentPatch).toHaveBeenCalledWith(
          {
            fragment: 'FRAGMENT',
            includeTitle: true,
            candidate: CANDIDATE,
            violations: { violations: [finding], omitted: [] },
            maxEnvelopeRepairs: 1,
            sessionId: 'run-1',
            timeLeftMs: 120_000,
          },
          expect.anything(),
        );
        expect(mocks.agent.repairDocument).not.toHaveBeenCalled();
        expect(mocks.agent.repairDocumentFallback).not.toHaveBeenCalled();
        expect(mocks.diagnostics.recordRepair).toHaveBeenCalledWith({
          kind: 'static',
          mode: 'patch',
          edits: 1,
          fallback: false,
        });
      });

      it('should take the complete document when the model answered with html', async () => {
        mocks.agent.repairDocumentPatch.mockResolvedValue({
          html: REWRITTEN,
          envelopeRepairs: 0,
        });

        await expect(
          repair(
            scope('patch'),
            { candidate: CANDIDATE, repairsSpent: 0 },
            [finding],
            'static',
          ),
        ).resolves.toEqual({ candidate: REWRITTEN, repairsSpent: 1 });
        expect(mocks.agent.repairDocumentFallback).not.toHaveBeenCalled();
        expect(mocks.diagnostics.recordRepair).toHaveBeenCalledWith({
          kind: 'static',
          mode: 'patch',
          edits: 0,
          fallback: false,
        });
      });

      it('should charge the envelope repair turn the patch Repair spent', async () => {
        mocks.agent.repairDocumentPatch.mockResolvedValue({
          edits: [EDIT],
          envelopeRepairs: 1,
        });

        await expect(
          repair(
            scope('patch'),
            { candidate: CANDIDATE, repairsSpent: 0 },
            [finding],
            'static',
          ),
        ).resolves.toEqual({ candidate: PATCHED, repairsSpent: 2 });
      });

      describe('when the edits do not apply', () => {
        beforeEach(() => {
          mocks.agent.repairDocumentPatch.mockResolvedValue({
            edits: [MISSING_EDIT],
            envelopeRepairs: 0,
          });
        });

        it('should make one fallback for the complete document, without charging the Repair budget', async () => {
          await expect(
            repair(
              scope('patch'),
              { candidate: CANDIDATE, repairsSpent: 0 },
              [finding],
              'render',
            ),
          ).resolves.toEqual({
            candidate: REWRITTEN,
            repairsSpent: 1,
            fallbacksSpent: 1,
          });

          expect(mocks.agent.repairDocumentFallback).toHaveBeenCalledTimes(1);
          expect(mocks.agent.repairDocumentFallback).toHaveBeenCalledWith(
            {
              fragment: 'FRAGMENT',
              includeTitle: true,
              candidate: CANDIDATE,
              violations: { violations: [finding], omitted: [] },
              maxEnvelopeRepairs: 1,
              sessionId: 'run-1',
              timeLeftMs: 120_000,
              edits: [MISSING_EDIT],
              problems: [expect.stringContaining('Edit 1: find not found')],
            },
            expect.anything(),
          );
          expect(mocks.diagnostics.recordRepairsSpent).toHaveBeenLastCalledWith(
            1,
          );
        });

        it('should record the round as a fallback with the edits the model answered with', async () => {
          await repair(
            scope('patch'),
            { candidate: CANDIDATE, repairsSpent: 0 },
            [finding],
            'render',
          );

          expect(mocks.diagnostics.recordRepair).toHaveBeenCalledTimes(1);
          expect(mocks.diagnostics.recordRepair).toHaveBeenCalledWith({
            kind: 'render',
            mode: 'patch',
            edits: 1,
            fallback: true,
          });
        });

        it('should still record the round as a fallback when the fallback call fails', async () => {
          mocks.agent.repairDocumentFallback.mockRejectedValue(
            new Error('provider down'),
          );

          await expect(
            repair(
              scope('patch'),
              { candidate: CANDIDATE, repairsSpent: 0 },
              [finding],
              'static',
            ),
          ).rejects.toThrow('provider down');

          expect(mocks.diagnostics.recordRepair).toHaveBeenCalledWith({
            kind: 'static',
            mode: 'patch',
            edits: 1,
            fallback: true,
          });
        });

        it('should bill the fallback through the metered hooks', async () => {
          mocks.agent.repairDocumentFallback.mockImplementation(
            (_input, hooks: { onUsage: (usage: unknown) => void }) => {
              hooks.onUsage({
                promptTokens: 10,
                completionTokens: 5,
                totalTokens: 15,
                cost: 0.07,
                model: 'test/generation-model',
                call: 'fallback',
              });
              return Promise.resolve({ html: REWRITTEN, envelopeRepairs: 0 });
            },
          );

          await repair(
            scope('patch'),
            { candidate: CANDIDATE, repairsSpent: 0 },
            [finding],
            'static',
          );

          expect(mocks.meter.record).toHaveBeenCalledWith(
            expect.objectContaining({ amount: 0.07 }),
          );
          expect(mocks.run.recordModelCall).toHaveBeenCalledWith(
            expect.objectContaining({ call: 'fallback' }),
          );
        });

        it('should check the deadline before the fallback, bounding it by the time left then', async () => {
          mocks.deadline.remainingMs
            .mockReturnValueOnce(90_000)
            .mockReturnValueOnce(40_000);

          await repair(
            scope('patch'),
            { candidate: CANDIDATE, repairsSpent: 0 },
            [finding],
            'static',
          );

          expect(mocks.deadline.assertTimeLeft).toHaveBeenCalledTimes(2);
          expect(mocks.deadline.assertTimeLeft).toHaveBeenLastCalledWith(
            WorkflowStep.GENERATE,
            'the fallback of Repair round 1 of artifact artifact-1 v1',
          );
          expect(mocks.agent.repairDocumentFallback).toHaveBeenCalledWith(
            expect.objectContaining({ timeLeftMs: 40_000 }),
            expect.anything(),
          );
        });

        it('should charge an envelope repair turn the fallback spends', async () => {
          mocks.agent.repairDocumentFallback.mockResolvedValue({
            html: REWRITTEN,
            envelopeRepairs: 1,
          });

          await expect(
            repair(
              scope('patch'),
              { candidate: CANDIDATE, repairsSpent: 0 },
              [finding],
              'static',
            ),
          ).resolves.toEqual({
            candidate: REWRITTEN,
            repairsSpent: 2,
            fallbacksSpent: 1,
          });
        });

        it('should allow the fallback no envelope repair turn when the round spent the budget', async () => {
          await repair(
            scope('patch'),
            { candidate: CANDIDATE, repairsSpent: 1 },
            [finding],
            'static',
          );

          expect(mocks.agent.repairDocumentFallback).toHaveBeenCalledWith(
            expect.objectContaining({ maxEnvelopeRepairs: 0 }),
            expect.anything(),
          );
        });

        it('should end the run as document.repair_exhausted when the fallback envelope is invalid with the budget spent', async () => {
          mocks.agent.repairDocumentFallback.mockRejectedValue(
            new ContentValidationError('html must not be empty'),
          );

          await expect(
            repair(
              scope('patch'),
              { candidate: CANDIDATE, repairsSpent: 1 },
              [finding],
              'static',
            ),
          ).rejects.toMatchObject({
            code: FailureCode.DOCUMENT_REPAIR_EXHAUSTED,
          });
        });

        it('should end the run as document.repair_exhausted, naming the edits by count, when the fallback is already spent', async () => {
          const failure = repair(
            scope('patch'),
            { candidate: CANDIDATE, repairsSpent: 0, fallbacksSpent: 1 },
            [finding],
            'static',
          );

          await expect(failure).rejects.toMatchObject({
            code: FailureCode.DOCUMENT_REPAIR_EXHAUSTED,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- an asymmetric matcher
            message: expect.stringContaining('1 edit(s)'),
          });
          await expect(failure).rejects.not.toThrow('secret text');
          expect(mocks.agent.repairDocumentFallback).not.toHaveBeenCalled();
        });

        it('should record the round as needing a fallback when the fallback is already spent', async () => {
          await expect(
            repair(
              scope('patch'),
              { candidate: CANDIDATE, repairsSpent: 0, fallbacksSpent: 1 },
              [finding],
              'static',
            ),
          ).rejects.toMatchObject({
            code: FailureCode.DOCUMENT_REPAIR_EXHAUSTED,
          });

          expect(mocks.diagnostics.recordRepair).toHaveBeenCalledWith({
            kind: 'static',
            mode: 'patch',
            edits: 1,
            fallback: true,
          });
        });

        it('should carry the fallback on through later rounds, so a second failure ends the run', async () => {
          const first = await repair(
            scope('patch'),
            { candidate: CANDIDATE, repairsSpent: 0 },
            [finding],
            'static',
          );

          await expect(
            repair(scope('patch'), first, [finding], 'render'),
          ).rejects.toMatchObject({
            code: FailureCode.DOCUMENT_REPAIR_EXHAUSTED,
          });
          expect(mocks.agent.repairDocumentFallback).toHaveBeenCalledTimes(1);
        });
      });
    });
  });

  describe('repairStatically', () => {
    it('should record one Repair entry per round until the candidate is clean', async () => {
      mockedCheck
        .mockReturnValueOnce([finding])
        .mockReturnValueOnce([finding])
        .mockReturnValueOnce([]);
      mocks.agent.repairDocumentPatch
        .mockResolvedValueOnce({ edits: [EDIT], envelopeRepairs: 0 })
        .mockResolvedValueOnce({ html: REWRITTEN, envelopeRepairs: 0 });

      await expect(
        repairStatically(scope('patch'), {
          candidate: CANDIDATE,
          repairsSpent: 0,
        }),
      ).resolves.toEqual({ candidate: REWRITTEN, repairsSpent: 2 });

      expect(mocks.diagnostics.recordRepair.mock.calls).toEqual([
        [{ kind: 'static', mode: 'patch', edits: 1, fallback: false }],
        [{ kind: 'static', mode: 'patch', edits: 0, fallback: false }],
      ]);
    });
  });
});
