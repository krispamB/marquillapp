import type {
  AgentHooks,
  AgentTurnUsage,
  ArtifactGenerationResult,
  GenerateInput,
} from '../../agent/agent-runner.interface';
import type { ReasoningEffort } from '../../llm/interfaces';
import {
  TEXT_EVAL_BRIEFS,
  type TextEvalBrief,
  type TextEvalType,
} from './briefs';
import type { TextEvalCliOptions } from './eval-text-options';

/** One model's answer to one brief, with what it cost in time and tokens. */
export interface TextEvalRecord {
  model: string;
  type: TextEvalType;
  briefId: string;
  prompt: string;
  ok: boolean;
  error?: string;
  /** Wall time of `generate`, repair turn included. */
  latencyMs: number;
  /** Model calls made: 2 means the first draft failed validation and was repaired. */
  calls: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUsd: number;
  title?: string;
  content?: ArtifactGenerationResult['content'];
}

export interface TextEvalResult {
  startedAt: string;
  finishedAt: string;
  models: string[];
  briefs: TextEvalBrief[];
  records: TextEvalRecord[];
}

/** What the runner needs from the outside: one `generate` on a named model. */
export interface TextEvalDeps {
  generate(
    model: string,
    input: GenerateInput,
    hooks: AgentHooks,
    effort?: ReasoningEffort,
  ): Promise<ArtifactGenerationResult>;
  now?: () => number;
}

/** The first `briefsPerType` briefs of each requested type, in fixture order. */
export function selectBriefs(
  types: readonly TextEvalType[],
  briefsPerType?: number,
): TextEvalBrief[] {
  return types.flatMap((type) =>
    TEXT_EVAL_BRIEFS.filter((brief) => brief.type === type).slice(
      0,
      briefsPerType,
    ),
  );
}

async function runOne(
  deps: TextEvalDeps,
  model: string,
  brief: TextEvalBrief,
  today: string,
  effort?: ReasoningEffort,
): Promise<TextEvalRecord> {
  const now = deps.now ?? Date.now;
  const turns: AgentTurnUsage[] = [];
  const input: GenerateInput = {
    type: brief.type,
    prompt: brief.prompt,
    today,
    ...(brief.stylePreset ? { stylePreset: brief.stylePreset } : {}),
  };
  const started = now();
  let outcome: Pick<TextEvalRecord, 'ok' | 'error' | 'title' | 'content'>;
  try {
    const result = await deps.generate(
      model,
      input,
      { onUsage: (usage) => turns.push(usage) },
      effort,
    );
    outcome = { ok: true, title: result.title, content: result.content };
  } catch (error: unknown) {
    outcome = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const latencyMs = now() - started;
  const sum = (pick: (turn: AgentTurnUsage) => number | undefined) =>
    turns.reduce((total, turn) => total + (pick(turn) ?? 0), 0);
  return {
    model,
    type: brief.type,
    briefId: brief.id,
    prompt: brief.prompt,
    ...outcome,
    latencyMs,
    calls: turns.length,
    promptTokens: sum((t) => t.promptTokens),
    completionTokens: sum((t) => t.completionTokens),
    reasoningTokens: sum((t) => t.reasoningTokens),
    totalTokens: sum((t) => t.totalTokens),
    costUsd: sum((t) => t.cost),
  };
}

/**
 * Runs every brief against every model through a small worker pool. Records
 * come back in model, then brief order, whatever order the calls finished in.
 */
export async function runTextEval(
  deps: TextEvalDeps,
  options: Pick<
    TextEvalCliOptions,
    'models' | 'types' | 'briefsPerType' | 'concurrency' | 'effort'
  >,
): Promise<TextEvalResult> {
  const startedAt = new Date().toISOString();
  // One date for the whole run, as a workflow run dates every attempt alike.
  const today = startedAt.slice(0, 10);
  const briefs = selectBriefs(options.types, options.briefsPerType);
  const jobs = options.models.flatMap((model) =>
    briefs.map((brief) => ({ model, brief })),
  );
  const records: TextEvalRecord[] = new Array<TextEvalRecord>(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const index = next++;
      const { model, brief } = jobs[index];
      records[index] = await runOne(deps, model, brief, today, options.effort);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(options.concurrency, jobs.length) }, worker),
  );
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    models: options.models,
    briefs,
    records,
  };
}
