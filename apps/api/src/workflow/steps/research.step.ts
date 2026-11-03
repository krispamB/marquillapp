import {
  USAGE_KINDS,
  type UsageRecord,
} from '../../feature-gating/credit-meter.constants';
import { WorkflowStep } from '../workflow.constants';
import { runDate } from '../engine/run-date';
import { RunEventType } from '../engine/run-event.types';
import type { ResearchResult } from '../../agent/agent-runner.interface';
import type { StepContext, StepHandler } from '../engine/workflow.types';

/**
 * The optional research turn, run only for `withResearch && kind === INITIAL`
 * (the builder gates it). It hands the agent loop the single `searchWeb` tool
 * and bridges its two live signals to the meter:
 *
 * - each LLM turn → `{ kind: 'llm', amount: usage.cost }`, so the SSE credit
 *   count climbs while the run is still searching;
 * - each search → `{ kind: 'web_search', amount: 1 }`, the fixed surcharge.
 *   Native research (`RESEARCH_MODE=native`) fires no search hook: the
 *   model's own searches are already priced in its `llm` cost, and their
 *   count rides along in the usage detail.
 *
 * Each LLM turn's tokens and time are tallied on the run record as well.
 *
 * It writes the `research` slot **and** persists `researchContext` on the run
 * record, which is what lets a later refine reuse the findings with zero
 * re-search. Tool errors are absorbed inside the loop; only an LLM transport
 * fault surfaces here, and `src/llm` has already classified it for the engine.
 *
 * A job retry after this step finished does not search again: the saved
 * research and the usage it recorded are read back, the usage is re-recorded
 * through the same meter, and the run bills like one that never retried.
 */
export const researchStep: StepHandler = async (state, ctx) => {
  const saved = await ctx.run.readResearchContext();

  if (saved) {
    // Same records through the same meter, so the retry's credits match the
    // original's, including each record's own rounding.
    for (const usage of saved.usage) ctx.meter.record(usage);

    emitSourcesFound(ctx, saved.research);
    return { research: saved.research };
  }

  const { prompt, type, stylePreset } = state.input;
  const usage: UsageRecord[] = [];
  const record = (entry: UsageRecord) => {
    usage.push(entry);
    ctx.meter.record(entry);
  };

  const research = await ctx.agent.research(
    // The run id groups the run's calls for provider cache affinity.
    {
      prompt,
      type,
      stylePreset,
      today: runDate(ctx),
      sessionId: ctx.run.runId,
    },
    {
      onUsage: (turn) => {
        record({
          kind: USAGE_KINDS.LLM,
          amount: turn.cost,
          detail: {
            model: turn.model,
            totalTokens: turn.totalTokens,
            // Native research: the searches are priced in `amount`, never surcharged.
            ...(turn.webSearchRequests
              ? { webSearchRequests: turn.webSearchRequests }
              : {}),
          },
        });
        ctx.run.recordModelCall(turn);
      },
      onToolCall: () => record({ kind: USAGE_KINDS.WEB_SEARCH, amount: 1 }),
    },
  );

  // Refine reads the research from the run record instead of re-searching (§5);
  // a job retry reads it with the usage to bill it again.
  await ctx.run.saveResearchContext(research, usage);

  emitSourcesFound(ctx, research);

  return { research };
};

// Best-effort progress signal; the core's step.started/completed still bracket
// the step whether or not this fires (R7 keeps step.progress optional).
const emitSourcesFound = (ctx: StepContext, research: ResearchResult) =>
  ctx.emit({
    type: RunEventType.STEP_PROGRESS,
    data: {
      step: WorkflowStep.RESEARCH,
      sourcesFound: research.sources.length,
    },
  });
