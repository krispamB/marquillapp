import type { ZodType } from 'zod';
import type { ArtifactType, CarouselTheme } from '../database/schemas';
import type { ArtifactContent } from '../artifact/schemas';
import type { LLMMessage, ToolCall, Usage } from '../llm/interfaces';
import type { StylePreset } from './style-presets.config';

/**
 * A provider-agnostic tool the agent loop can call. `parameters` doubles as the
 * JSON-Schema source Layer 1 hands the model and the validator for the arguments
 * it sends back.
 */
export interface Tool<I = unknown, O = unknown> {
  name: string;
  description: string;
  parameters: ZodType<I>;
  execute: (input: I) => Promise<O>;
}

export interface AgentRunConfig {
  system: string;
  messages: LLMMessage[];
  tools: Tool[];
  maxSteps: number;
  maxSuccessfulToolCalls?: number;
  model?: string;
}

/** One turn of the loop that asked for tools, plus what running them produced. */
export interface AgentStep {
  toolCalls: ToolCall[];
  toolResults: unknown[];
  usage: Usage;
}

export interface AgentRunResult {
  text: string;
  steps: AgentStep[];
  usage: Usage;
}

export interface ResearchSource {
  title: string;
  url: string;
}

// `findings` is the agent's own synthesis after searching, not a dump of raw
// search bodies. Stored verbatim on WorkflowRun.researchContext so a refine
// reuses it with zero re-search.
export interface ResearchResult {
  findings: string;
  sources: ResearchSource[];
}

export interface ResearchInput {
  prompt: string;
  type: ArtifactType;
  stylePreset?: StylePreset;
}

export interface GenerateInput {
  type: ArtifactType;
  prompt: string;
  stylePreset?: StylePreset;
  theme?: CarouselTheme;
  research?: ResearchResult;
  refine?: { priorContent: ArtifactContent; feedback: string };
}

export interface ArtifactGenerationResult {
  title?: string;
  content: ArtifactContent;
}

// One LLM turn's usage, tagged with the model that produced it. The step needs
// the model to fill `UsageDetail`, and Layer 1's `Usage` does not carry it.
export interface AgentTurnUsage extends Usage {
  model: string;
}

/**
 * `AgentRunner` must not hold the meter, so usage leaves it through hooks the
 * step bridges to `ctx.meter`. Live per-turn emission is what lets the SSE
 * stream show a climbing credit count during a long run.
 */
export interface AgentHooks {
  onUsage?: (usage: AgentTurnUsage) => void;
  // Fired by the research tool loop (#117); `generate` calls no tools.
  onToolCall?: (tool: { name: string }) => void;
}

// Narrow role interface consumed by the workflow engine's StepContext. Steps
// depend on this, not on `AgentRunnerService`.
export interface AgentRunner {
  research(input: ResearchInput, hooks?: AgentHooks): Promise<ResearchResult>;
  generate(
    input: GenerateInput,
    hooks?: AgentHooks,
  ): Promise<ArtifactGenerationResult>;
}
