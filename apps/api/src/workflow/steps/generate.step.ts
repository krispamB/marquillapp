import {
  ContentValidationError,
  DocumentTruncatedError,
} from '../../agent/agent-runner.error';
import type { AgentHooks } from '../../agent/agent-runner.interface';
import type { DesignSystemDefinition } from '../../design-system/design-system-definition';
import { ArtifactType, RunKind } from '../../database/schemas';
import { check } from '../../document-source/candidate-check';
import { sha256Hex } from '../../document-source/sha256';
import {
  boundViolations,
  type Violation,
} from '../../document-source/violation';
import { USAGE_KINDS } from '../../feature-gating/credit-meter.constants';
import { RunEventType } from '../engine/run-event.types';
import { terminal } from '../engine/workflow.error';
import type {
  RunState,
  StepContext,
  StepHandler,
} from '../engine/workflow.types';
import {
  DOCUMENT_REPAIR_BUDGET,
  FailureCode,
  WorkflowStep,
} from '../workflow.constants';

/** The envelope code for a Candidate Source over the size cap (spec §4.4). */
const TRUNCATED_CODE = 'envelope.truncated';

/**
 * The hinge: the AI product every downstream code step renders or persists.
 *
 * POST and POLL are one structured completion: `AgentRunner` owns the prompt,
 * the schema, and the inline repair retry. Exactly two failure arms:
 *
 * - **terminal** — content that failed Zod even after the warm repair (R2).
 * - **retryable** — an LLM transport fault, which `src/llm` already classified
 *   and the engine's `toWorkflowError` reads straight off the `LLMError`.
 *
 * DOCUMENT drafts a Candidate Source and repairs it until it is statically
 * clean (spec §7.1).
 */
export const generateStep: StepHandler = async (state, ctx) => {
  if (state.input.type === ArtifactType.DOCUMENT) {
    return generateDocument(state, ctx);
  }

  const { type, prompt, stylePreset } = state.input;

  try {
    const generated = await ctx.agent.generate(
      {
        type,
        prompt,
        stylePreset,
        research: state.research,
        refine: state.refine,
      },
      meteredHooks(ctx),
    );

    return {
      ...(generated.title !== undefined
        ? { generatedTitle: generated.title }
        : {}),
      content: generated.content,
    };
  } catch (error: unknown) {
    if (error instanceof ContentValidationError) {
      throw terminal(error.message, error);
    }
    throw error;
  }
};

/**
 * Per-turn, so a repair turn is billed like any other and the SSE stream's
 * credit count climbs while the run is still in flight.
 */
const meteredHooks = (ctx: StepContext): AgentHooks => ({
  onUsage: (usage) =>
    ctx.meter.record({
      kind: USAGE_KINDS.LLM,
      amount: usage.cost,
      detail: { model: usage.model, totalTokens: usage.totalTokens },
    }),
});

/**
 * DOCUMENT: draft, then static Repairs until the Candidate Source is clean or
 * the shared Repair budget is spent (spec §7.1, §7.2). Every check's full
 * result is recorded on the run; the client sees only phases and counts.
 *
 * A source over the size cap, or a call cut off at the token cap, is
 * `document.truncated` and spends nothing: a Repair cannot make it shorter.
 */
async function generateDocument(
  state: RunState,
  ctx: StepContext,
): Promise<Partial<RunState>> {
  const { artifactId, version, prompt, stylePreset, kind } = state.input;
  const designSystem = state.designSystem;
  if (!designSystem) {
    // RESOLVE_INPUT loads the pin for every DOCUMENT run, so an empty slot is
    // a wiring bug a replay would reproduce exactly.
    throw terminal(
      `GENERATE reached without a Design System for artifact ${artifactId} v${version}`,
    );
  }
  const { definition, fragment } = designSystem;
  const includeTitle = kind === RunKind.INITIAL;
  const hooks = meteredHooks(ctx);
  const label = `artifact ${artifactId} v${version}`;

  ctx.emit({
    type: RunEventType.STEP_PROGRESS,
    data: { step: WorkflowStep.GENERATE, phase: 'draft' },
  });

  const draftAllowance = envelopeAllowance(0);
  const draft = await callModel(draftAllowance, label, () =>
    ctx.agent.generateDocument(
      {
        prompt,
        stylePreset,
        research: state.research,
        fragment,
        includeTitle,
        maxEnvelopeRepairs: draftAllowance,
      },
      hooks,
    ),
  );

  let repairsSpent = draft.envelopeRepairs;
  let candidate = draft.html;
  let violations = await checkStatically(ctx, definition, candidate);

  while (violations.length > 0) {
    if (violations.some(({ code }) => code === TRUNCATED_CODE)) {
      throw terminal(
        `The Candidate Source for ${label} is over the size cap`,
        undefined,
        FailureCode.DOCUMENT_TRUNCATED,
      );
    }
    if (repairsSpent >= DOCUMENT_REPAIR_BUDGET) {
      throw terminal(
        `The Candidate Source for ${label} still has ${violations.length} static violation(s) after ${repairsSpent} Repair turn(s)`,
        undefined,
        FailureCode.DOCUMENT_REPAIR_EXHAUSTED,
      );
    }

    repairsSpent += 1;
    ctx.emit({
      type: RunEventType.STEP_PROGRESS,
      data: {
        step: WorkflowStep.GENERATE,
        phase: 'repair',
        round: repairsSpent,
        violations: violations.length,
      },
    });

    const allowance = envelopeAllowance(repairsSpent);
    const repaired = await callModel(allowance, label, () =>
      ctx.agent.repairDocument(
        {
          fragment,
          includeTitle,
          candidate,
          violations: boundViolations(violations),
          maxEnvelopeRepairs: allowance,
        },
        hooks,
      ),
    );

    repairsSpent += repaired.envelopeRepairs;
    candidate = repaired.html;
    violations = await checkStatically(ctx, definition, candidate);
  }

  return {
    ...(draft.title !== undefined ? { generatedTitle: draft.title } : {}),
    draft: { commentary: draft.commentary, candidate, repairsSpent },
  };
}

/** A model call may spend at most one Zod repair turn, and only if one is left. */
const envelopeAllowance = (repairsSpent: number): number =>
  Math.min(1, DOCUMENT_REPAIR_BUDGET - repairsSpent);

/**
 * Maps the agent's DOCUMENT errors. An invalid envelope is terminal: as
 * `document.repair_exhausted` when the budget left it no repair turn, and as
 * `internal` when its repair turn failed too (R2).
 */
async function callModel<T>(
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
  ctx: StepContext,
  definition: DesignSystemDefinition,
  candidate: string,
): Promise<Violation[]> {
  const violations = check(definition, candidate);
  await ctx.run.recordDocumentCheck({
    phase: 'static',
    candidateSha256: sha256Hex(candidate),
    violations,
    checkedAt: new Date(),
  });
  return violations;
}
