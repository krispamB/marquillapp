import type { ZodType } from 'zod';
import type { ArtifactType } from '../database/schemas';
import type { ArtifactContent } from '../artifact/schemas';
import type { BoundedViolations } from '../document-source/violation';
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
  research?: ResearchResult;
  refine?: { priorContent: ArtifactContent; feedback: string };
}

/** The INITIAL DOCUMENT draft (spec §7.5). Refinement arrives with #171. */
export interface DocumentGenerateInput {
  prompt: string;
  stylePreset?: StylePreset;
  research?: ResearchResult;
  /** The pinned Design System's prompt fragment. */
  fragment: string;
  /** INITIAL runs ask for a title; nothing else does. */
  includeTitle: boolean;
  /**
   * Zod repair turns this call may spend from the shared Repair budget
   * (spec §7.2). At most one is ever used; `0` makes an invalid envelope
   * final.
   */
  maxEnvelopeRepairs: number;
}

/**
 * One static or render Repair (spec §7.2). The system message is the draft's,
 * so `fragment` and `includeTitle` must be the draft's too.
 */
export interface DocumentRepairInput {
  fragment: string;
  includeTitle: boolean;
  /** The Candidate Source the violations were found in. */
  candidate: string;
  violations: BoundedViolations;
  /** As on `DocumentGenerateInput`. */
  maxEnvelopeRepairs: number;
}

/** What the model wrote: `html` is the Candidate Source, still unchecked. */
export interface DocumentDraftResult {
  title?: string;
  commentary: string;
  html: string;
  /** Zod repair turns spent, each one a turn of the Repair budget. */
  envelopeRepairs: number;
}

/**
 * A Repair's Candidate Source. Its `title` and `commentary` are ignored, so
 * they never leave the agent.
 */
export interface DocumentRepairResult {
  html: string;
  envelopeRepairs: number;
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
  // Fired by the research tool loop (#112); `generate` calls no tools.
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
  /**
   * One DOCUMENT draft. Throws `DocumentTruncatedError` when the output hit
   * the token cap, and `ContentValidationError` when the envelope is invalid
   * and no repair turn is allowed or left. It never checks the Candidate
   * Source itself.
   */
  generateDocument(
    input: DocumentGenerateInput,
    hooks?: AgentHooks,
  ): Promise<DocumentDraftResult>;
  /** One Repair of a Candidate Source. Throws as `generateDocument` does. */
  repairDocument(
    input: DocumentRepairInput,
    hooks?: AgentHooks,
  ): Promise<DocumentRepairResult>;
}
