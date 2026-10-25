import { ContentValidationError } from '../../agent/agent-runner.error';
import type { DocumentRefineInput } from '../../agent/agent-runner.interface';
import { ArtifactType, RunKind } from '../../database/schemas';
import { runDate } from '../engine/run-date';
import { RunEventType } from '../engine/run-event.types';
import { terminal } from '../engine/workflow.error';
import type {
  RunState,
  StepContext,
  StepHandler,
} from '../engine/workflow.types';
import { WorkflowStep } from '../workflow.constants';
import {
  callModel,
  envelopeAllowance,
  meteredHooks,
  repairStatically,
} from './document-repair';

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
 * DOCUMENT drafts a Candidate Source, from the brief or by rewriting the
 * refine base, and repairs it until it is statically clean (spec §7.1).
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
        today: runDate(ctx),
        sessionId: ctx.run.runId,
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
 * DOCUMENT: draft, then static Repairs until the Candidate Source is clean or
 * the shared Repair budget is spent (spec §7.1, §7.2). Every check's full
 * result is recorded on the run; the client sees only phases and counts.
 *
 * A job retry after `RENDER_PDF` saved a checkpoint returns it without calling
 * the model, so the draft is neither rewritten nor billed again (spec §7.3).
 *
 * A call cut off at the token cap is `document.truncated` and spends nothing.
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

  const accepted = await ctx.run.readAcceptedCandidate();
  if (accepted) {
    ctx.logger.log(`GENERATE resumed ${label} from its accepted candidate`);
    ctx.diagnostics.recordAccepted(accepted.candidate, accepted.repairsSpent);
    ctx.diagnostics.recordRepairsSpent(accepted.repairsSpent);
    return {
      ...(accepted.title !== undefined
        ? { generatedTitle: accepted.title }
        : {}),
      draft: {
        commentary: accepted.commentary,
        candidate: accepted.candidate,
        repairsSpent: accepted.repairsSpent,
      },
    };
  }

  const refine = includeTitle ? undefined : refineBaseOf(state, label);

  ctx.deadline.assertTimeLeft(WorkflowStep.GENERATE, `the draft of ${label}`);
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
        ...(refine ? { refine } : {}),
        today: runDate(ctx),
        sessionId: ctx.run.runId,
        timeLeftMs: ctx.deadline.remainingMs(),
      },
      hooks,
    ),
  );

  ctx.diagnostics.recordRepairsSpent(draft.envelopeRepairs);
  const { candidate, repairsSpent, fallbacksSpent } = await repairStatically(
    {
      ctx,
      step: WorkflowStep.GENERATE,
      definition,
      fragment,
      includeTitle,
      label,
    },
    { candidate: draft.html, repairsSpent: draft.envelopeRepairs },
  );

  return {
    ...(draft.title !== undefined ? { generatedTitle: draft.title } : {}),
    draft: {
      commentary: draft.commentary,
      candidate,
      repairsSpent,
      ...(fallbacksSpent !== undefined ? { fallbacksSpent } : {}),
    },
  };
}

/**
 * A refinement rewrites its base (spec §6.5): the Candidate Source
 * `RESOLVE_INPUT` verified, the base's commentary, and the feedback.
 */
function refineBaseOf(state: RunState, label: string): DocumentRefineInput {
  const { refine, baseCandidate } = state;
  if (!refine || baseCandidate === undefined) {
    // RESOLVE_INPUT seeds both for every DOCUMENT REFINE, so their absence is
    // a wiring bug a replay would reproduce exactly.
    throw terminal(`GENERATE reached ${label} without its refine base`);
  }
  const { commentary } = refine.priorContent;
  return {
    candidate: baseCandidate,
    ...(commentary !== undefined ? { commentary } : {}),
    feedback: refine.feedback,
  };
}
