import { USAGE_KINDS } from '../../feature-gating/credit-meter.constants';
import { WorkflowStep } from '../workflow.constants';
import { RunEventType } from '../engine/run-event.types';
import type { StepHandler } from '../engine/workflow.types';

/**
 * The optional research turn, run only for `withResearch && kind === INITIAL`
 * (the builder gates it). It hands the agent loop the single `searchWeb` tool
 * and bridges its two live signals to the meter:
 *
 * - each LLM turn → `{ kind: 'llm', amount: usage.cost }`, so the SSE credit
 *   count climbs while the run is still searching;
 * - each search → `{ kind: 'web_search', amount: 1 }`, the fixed surcharge.
 *
 * It writes the `research` slot **and** persists `researchContext` on the run
 * record, which is what lets a later refine reuse the findings with zero
 * re-search. Tool errors are absorbed inside the loop; only an LLM transport
 * fault surfaces here, and `src/llm` has already classified it for the engine.
 */
export const researchStep: StepHandler = async (state, ctx) => {
  const { prompt, type, stylePreset } = state.input;

  const research = await ctx.agent.research(
    { prompt, type, stylePreset },
    {
      onUsage: (usage) =>
        ctx.meter.record({
          kind: USAGE_KINDS.LLM,
          amount: usage.cost,
          detail: { model: usage.model, totalTokens: usage.totalTokens },
        }),
      onToolCall: () =>
        ctx.meter.record({ kind: USAGE_KINDS.WEB_SEARCH, amount: 1 }),
    },
  );

  // Refine reads this from the run record instead of re-searching (§5).
  await ctx.run.saveResearchContext(research);

  // Best-effort progress signal; the core's step.started/completed still bracket
  // the step whether or not this fires (R7 keeps step.progress optional).
  ctx.emit({
    type: RunEventType.STEP_PROGRESS,
    data: {
      step: WorkflowStep.RESEARCH,
      sourcesFound: research.sources.length,
    },
  });

  return { research };
};
