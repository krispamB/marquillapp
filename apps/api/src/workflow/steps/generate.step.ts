import {
  ContentValidationError,
  DocumentTruncatedError,
} from '../../agent/agent-runner.error';
import type { AgentHooks } from '../../agent/agent-runner.interface';
import { ArtifactType, RunKind } from '../../database/schemas';
import { check } from '../../document-source/candidate-check';
import { sha256Hex } from '../../document-source/sha256';
import { USAGE_KINDS } from '../../feature-gating/credit-meter.constants';
import { RunEventType } from '../engine/run-event.types';
import { terminal } from '../engine/workflow.error';
import type {
  RunState,
  StepContext,
  StepHandler,
} from '../engine/workflow.types';
import { FailureCode, WorkflowStep } from '../workflow.constants';

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
 * DOCUMENT drafts a Candidate Source and checks it statically (spec §7.1).
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
 * DOCUMENT: draft, then the static check (spec §7.1). The check's full result
 * is recorded on the run; the client sees only a phase.
 *
 * There is no Repair yet (#167): any static violation fails the Attempt as
 * `document.repair_exhausted`, except a source over the size cap, which is
 * `document.truncated` like a draft cut off at the token cap.
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

  ctx.emit({
    type: RunEventType.STEP_PROGRESS,
    data: { step: WorkflowStep.GENERATE, phase: 'draft' },
  });

  let draft: Awaited<ReturnType<typeof ctx.agent.generateDocument>>;
  try {
    draft = await ctx.agent.generateDocument(
      {
        prompt,
        stylePreset,
        research: state.research,
        fragment: designSystem.fragment,
        includeTitle: kind === RunKind.INITIAL,
      },
      meteredHooks(ctx),
    );
  } catch (error: unknown) {
    if (error instanceof DocumentTruncatedError) {
      throw terminal(error.message, error, FailureCode.DOCUMENT_TRUNCATED);
    }
    if (error instanceof ContentValidationError) {
      throw terminal(error.message, error);
    }
    throw error;
  }

  const violations = check(designSystem.definition, draft.html);
  await ctx.run.recordDocumentCheck({
    phase: 'static',
    candidateSha256: sha256Hex(draft.html),
    violations,
    checkedAt: new Date(),
  });

  if (violations.length > 0) {
    const truncated = violations.some(({ code }) => code === TRUNCATED_CODE);
    throw terminal(
      `The Candidate Source for artifact ${artifactId} v${version} has ${violations.length} static violation(s), and there is no Repair`,
      undefined,
      truncated
        ? FailureCode.DOCUMENT_TRUNCATED
        : FailureCode.DOCUMENT_REPAIR_EXHAUSTED,
    );
  }

  return {
    ...(draft.title !== undefined ? { generatedTitle: draft.title } : {}),
    draft: { commentary: draft.commentary, candidate: draft.html },
  };
}
