import { ContentValidationError } from '../../agent/agent-runner.error';
import { USAGE_KINDS } from '../../feature-gating/credit-meter.constants';
import { terminal } from '../engine/workflow.error';
import type { StepHandler } from '../engine/workflow.types';

/**
 * The hinge: the AI product every downstream code step renders or persists.
 * One structured completion — `AgentRunner` owns the prompt, the schema, and the
 * inline repair retry.
 *
 * Exactly two failure arms:
 *
 * - **terminal** — content that failed Zod even after the warm repair (R2).
 * - **retryable** — an LLM transport fault, which `src/llm` already classified
 *   and the engine's `toWorkflowError` reads straight off the `LLMError`.
 */
export const generateStep: StepHandler = async (state, ctx) => {
  const { type, prompt, stylePreset, theme } = state.input;

  try {
    const generated = await ctx.agent.generate(
      {
        type,
        prompt,
        stylePreset,
        theme,
        research: state.research,
        refine: state.refine,
      },
      {
        // Per-turn, so a repair turn is billed like any other and the SSE
        // stream's credit count climbs while the run is still in flight.
        onUsage: (usage) =>
          ctx.meter.record({
            kind: USAGE_KINDS.LLM,
            amount: usage.cost,
            detail: { model: usage.model, totalTokens: usage.totalTokens },
          }),
      },
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
