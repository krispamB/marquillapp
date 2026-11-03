import {
  ContentValidationError,
  DocumentTruncatedError,
} from '../../agent/agent-runner.error';
import type {
  AgentHooks,
  DocumentRepairInput,
} from '../../agent/agent-runner.interface';
import type { DesignSystemDefinition } from '../../design-system/design-system-definition';
import { check } from '../../document-source/candidate-check';
import { applyEdits } from '../../document-source/candidate-patch';
import { sha256Hex } from '../../document-source/sha256';
import {
  boundViolations,
  type Violation,
} from '../../document-source/violation';
import { USAGE_KINDS } from '../../feature-gating/credit-meter.constants';
import { RunEventType } from '../engine/run-event.types';
import { terminal } from '../engine/workflow.error';
import type {
  DocumentCheck,
  RepairDiagnostic,
  StepContext,
} from '../engine/workflow.types';
import {
  DOCUMENT_REPAIR_BUDGET,
  DOCUMENT_REPAIR_FALLBACKS,
  DOCUMENT_REPAIR_MODE,
  type DocumentRepairMode,
  FailureCode,
  WorkflowStep,
} from '../workflow.constants';

/** The envelope code for a Candidate Source over the size cap (spec §4.4). */
const TRUNCATED_CODE = 'envelope.truncated';

/**
 * What a DOCUMENT step needs to spend the shared Repair budget (spec §7.2).
 * `fragment` and `includeTitle` are the draft's, so a Repair's system message
 * is byte-identical to the draft call's.
 */
export interface RepairScope {
  ctx: StepContext;
  /** The step whose `step.progress` announces each Repair round. */
  step: WorkflowStep.GENERATE | WorkflowStep.RENDER_PDF;
  definition: DesignSystemDefinition;
  fragment: string;
  includeTitle: boolean;
  /** `artifact {id} v{version}`, for failure messages. */
  label: string;
  /** What a Repair answers with; `DOCUMENT_REPAIR_MODE` when unset. */
  mode?: DocumentRepairMode;
}

/** A Candidate Source and the Repair turns and fallbacks spent reaching it. */
export interface RepairedCandidate {
  candidate: string;
  repairsSpent: number;
  /**
   * `patch`-mode fallbacks spent in this job attempt, at most
   * `DOCUMENT_REPAIR_FALLBACKS`; absent means none.
   */
  fallbacksSpent?: number;
}

/**
 * Per-turn, so a repair turn is billed like any other and the SSE stream's
 * credit count climbs while the run is still in flight. The run record
 * tallies the turn's tokens and time too.
 */
export const meteredHooks = (ctx: StepContext): AgentHooks => ({
  onUsage: (usage) => {
    ctx.meter.record({
      kind: USAGE_KINDS.LLM,
      amount: usage.cost,
      detail: { model: usage.model, totalTokens: usage.totalTokens },
    });
    ctx.run.recordModelCall(usage);
    ctx.diagnostics.recordModelTurn(usage);
  },
});

/**
 * Records one check of a Candidate Source: its codes and counts in the run's
 * diagnostics, then its full violation list on the run. In that order, so a
 * failed write still leaves the outcome in the diagnostics.
 */
export async function recordCheck(
  ctx: StepContext,
  phase: DocumentCheck['phase'],
  candidate: string,
  violations: Violation[],
): Promise<void> {
  ctx.diagnostics.recordCheck(phase, candidate, violations);
  await ctx.run.recordDocumentCheck({
    phase,
    candidateSha256: sha256Hex(candidate),
    violations,
    checkedAt: new Date(),
  });
}

/**
 * Static-checks the Candidate Source and repairs it until it is clean or the
 * shared budget is spent. A source over the size cap is `document.truncated`
 * and spends nothing: a Repair cannot make it shorter.
 */
export async function repairStatically(
  scope: RepairScope,
  { candidate, repairsSpent }: RepairedCandidate,
): Promise<RepairedCandidate> {
  let current = { candidate, repairsSpent };
  let violations = await checkStatically(scope, current.candidate);

  while (violations.length > 0) {
    if (violations.some(({ code }) => code === TRUNCATED_CODE)) {
      throw terminal(
        `The Candidate Source for ${scope.label} is over the size cap`,
        undefined,
        FailureCode.DOCUMENT_TRUNCATED,
      );
    }
    current = await repair(scope, current, violations, 'static');
    violations = await checkStatically(scope, current.candidate);
  }
  return current;
}

/**
 * One Repair round on `violations`, or `document.repair_exhausted` when the
 * budget is spent. In `full` mode the model re-emits the Candidate Source; in
 * `patch` mode it answers with edits, applied here, or with the whole of it.
 * Edits that do not apply get one `{ html }` fallback per job attempt, billed
 * but not a turn of the budget. Either way the result is still unchecked.
 */
export async function repair(
  scope: RepairScope,
  current: RepairedCandidate,
  violations: Violation[],
  kind: 'static' | 'render',
): Promise<RepairedCandidate> {
  const { ctx, step, fragment, includeTitle, label } = scope;
  const { candidate, repairsSpent } = current;
  if (repairsSpent >= DOCUMENT_REPAIR_BUDGET) {
    throw terminal(
      `The Candidate Source for ${label} still has ${violations.length} ${kind} violation(s) after ${repairsSpent} Repair turn(s)`,
      undefined,
      FailureCode.DOCUMENT_REPAIR_EXHAUSTED,
    );
  }

  const round = repairsSpent + 1;
  ctx.deadline.assertTimeLeft(step, `Repair round ${round} of ${label}`);
  ctx.emit({
    type: RunEventType.STEP_PROGRESS,
    data: { step, phase: 'repair', round, violations: violations.length },
  });

  const allowance = envelopeAllowance(round);
  const input: DocumentRepairInput = {
    fragment,
    includeTitle,
    candidate,
    violations: boundViolations(violations),
    maxEnvelopeRepairs: allowance,
    sessionId: ctx.run.runId,
    timeLeftMs: ctx.deadline.remainingMs(),
  };
  const mode = scope.mode ?? DOCUMENT_REPAIR_MODE;
  const answered =
    mode === 'full'
      ? await repairInFull(scope, input, allowance, current)
      : await repairWithEdits(scope, input, allowance, current, round, kind);

  const spent = round + answered.envelopeRepairs;
  ctx.diagnostics.recordRepairsSpent(spent);
  if (answered.diagnostic !== null) {
    ctx.diagnostics.recordRepair({ kind, mode, ...answered.diagnostic });
  }
  return {
    candidate: answered.candidate,
    repairsSpent: spent,
    ...(answered.fallbacksSpent !== undefined
      ? { fallbacksSpent: answered.fallbacksSpent }
      : {}),
  };
}

/** What one Repair round's model calls produced, before it is charged. */
interface RoundAnswer {
  candidate: string;
  /** Zod repair turns spent across the round's calls. */
  envelopeRepairs: number;
  fallbacksSpent?: number;
  /** `null` when the round recorded its own entry: edits that did not apply. */
  diagnostic: Pick<RepairDiagnostic, 'edits' | 'fallback'> | null;
}

async function repairInFull(
  { ctx, label }: RepairScope,
  input: DocumentRepairInput,
  allowance: number,
  { fallbacksSpent }: RepairedCandidate,
): Promise<RoundAnswer> {
  const repaired = await callModel(allowance, label, () =>
    ctx.agent.repairDocument(input, meteredHooks(ctx)),
  );
  return {
    candidate: repaired.html,
    envelopeRepairs: repaired.envelopeRepairs,
    fallbacksSpent,
    diagnostic: { edits: 0, fallback: false },
  };
}

/**
 * A `patch`-mode round. Failed edits never get a second set of edits: the
 * fallback asks for the whole Candidate Source, and once the job attempt has spent it,
 * failed edits are terminal.
 */
async function repairWithEdits(
  { ctx, step, label }: RepairScope,
  input: DocumentRepairInput,
  allowance: number,
  { candidate, fallbacksSpent }: RepairedCandidate,
  round: number,
  kind: RepairDiagnostic['kind'],
): Promise<RoundAnswer> {
  const answer = await callModel(allowance, label, () =>
    ctx.agent.repairDocumentPatch(input, meteredHooks(ctx)),
  );
  if ('html' in answer) {
    return {
      candidate: answer.html,
      envelopeRepairs: answer.envelopeRepairs,
      fallbacksSpent,
      diagnostic: { edits: 0, fallback: false },
    };
  }

  const { edits } = answer;
  const patched = applyEdits(candidate, edits);
  if (patched.ok) {
    return {
      candidate: patched.candidate,
      envelopeRepairs: answer.envelopeRepairs,
      fallbacksSpent,
      diagnostic: { edits: edits.length, fallback: false },
    };
  }

  // Recorded now, before the fallback can end the run, so the eval's
  // fallback rate counts every round whose edits did not apply.
  ctx.diagnostics.recordRepair({
    kind,
    mode: 'patch',
    edits: edits.length,
    fallback: true,
  });
  const spent = fallbacksSpent ?? 0;
  if (spent >= DOCUMENT_REPAIR_FALLBACKS) {
    // The problems quote the edits, so only their count is named.
    ctx.diagnostics.recordRepairsSpent(round + answer.envelopeRepairs);
    throw terminal(
      `The ${edits.length} edit(s) Repair round ${round} answered for ${label} did not apply (${patched.problems.length} problem(s)), and the job attempt's fallback is spent`,
      undefined,
      FailureCode.DOCUMENT_REPAIR_EXHAUSTED,
    );
  }

  ctx.deadline.assertTimeLeft(
    step,
    `the fallback of Repair round ${round} of ${label}`,
  );
  const fallbackAllowance = envelopeAllowance(round + answer.envelopeRepairs);
  const fallback = await callModel(fallbackAllowance, label, () =>
    ctx.agent.repairDocumentFallback(
      {
        ...input,
        maxEnvelopeRepairs: fallbackAllowance,
        timeLeftMs: ctx.deadline.remainingMs(),
        edits,
        problems: patched.problems,
      },
      meteredHooks(ctx),
    ),
  );
  return {
    candidate: fallback.html,
    envelopeRepairs: answer.envelopeRepairs + fallback.envelopeRepairs,
    fallbacksSpent: spent + 1,
    diagnostic: null,
  };
}

/** A model call may spend at most one Zod repair turn, and only if one is left. */
export const envelopeAllowance = (repairsSpent: number): number =>
  Math.min(1, DOCUMENT_REPAIR_BUDGET - repairsSpent);

/**
 * Maps the agent's DOCUMENT errors. An invalid envelope is terminal: as
 * `document.repair_exhausted` when the budget left it no repair turn, and as
 * `internal` when its repair turn failed too (R2).
 */
export async function callModel<T>(
  allowance: number,
  label: string,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (error: unknown) {
    if (error instanceof DocumentTruncatedError) {
      throw terminal(error.message, error, FailureCode.DOCUMENT_TRUNCATED);
    }
    if (error instanceof ContentValidationError) {
      throw allowance > 0
        ? terminal(error.message, error)
        : terminal(
            `The envelope for ${label} is invalid and the Repair budget is spent: ${error.message}`,
            error,
            FailureCode.DOCUMENT_REPAIR_EXHAUSTED,
          );
    }
    throw error;
  }
}

async function checkStatically(
  { ctx, definition }: RepairScope,
  candidate: string,
): Promise<Violation[]> {
  const violations = check(definition, candidate);
  await recordCheck(ctx, 'static', candidate, violations);
  return violations;
}
