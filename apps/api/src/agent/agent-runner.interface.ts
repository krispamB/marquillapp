import type { ZodType } from 'zod';
import type { CandidateEdit } from '../document-source/candidate-patch';
import type { ArtifactType } from '../database/schemas';
import type { ArtifactContent } from '../artifact/schemas';
import type { BoundedViolations } from '../document-source/violation';
import type {
  LLMMessage,
  ReasoningEffort,
  ToolCall,
  Usage,
} from '../llm/interfaces';
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

export interface AgentRunConfig extends SessionAffinity {
  system: string;
  messages: LLMMessage[];
  tools: Tool[];
  maxSteps: number;
  maxSuccessfulToolCalls?: number;
  model?: string;
  /** Sent on every turn and the closing call. Unset sends none. */
  reasoningEffort?: ReasoningEffort;
  /**
   * Caps each turn's (and the closing call's) per-try timeout below the
   * provider's. Unset keeps the provider's.
   */
  turnTimeoutMs?: number;
}

/**
 * Groups every LLM call made for one input under one provider session, for
 * prompt-cache affinity. Steps pass the run id.
 */
export interface SessionAffinity {
  sessionId?: string;
}

/**
 * The run deadline's time left when a DOCUMENT call starts. The call, its
 * retries and its envelope repair all end by then. Unset means no deadline.
 */
export interface RunTimeLeft {
  timeLeftMs?: number;
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

/**
 * How research was done (`RESEARCH_MODE`). Absent means `agent`, which is what
 * every research result stored before snippet mode existed was.
 */
export type ResearchMode = 'agent' | 'snippets';

// In `agent` mode `findings` is the agent's own synthesis after searching, not
// a dump of raw search bodies. In `snippets` mode it is the numbered raw web
// excerpts ("[n] Title (url)" blocks), and `mode` says so. Stored verbatim on
// WorkflowRun.researchContext so a refine reuses it with zero re-search.
export interface ResearchResult {
  findings: string;
  sources: ResearchSource[];
  mode?: ResearchMode;
}

/**
 * The run's date as UTC `YYYY-MM-DD`, stated in every research and generation
 * prompt so the model does not take its training-era year as the present.
 * Steps derive it from the run's creation time, so every job attempt of a run
 * sees the same date.
 */
export interface RunDate {
  today: string;
}

export interface ResearchInput extends SessionAffinity, RunDate {
  prompt: string;
  type: ArtifactType;
  stylePreset?: StylePreset;
}

export interface GenerateInput extends SessionAffinity, RunDate {
  type: ArtifactType;
  prompt: string;
  stylePreset?: StylePreset;
  research?: ResearchResult;
  refine?: { priorContent: ArtifactContent; feedback: string };
}

/**
 * What a DOCUMENT refinement sees of its base (spec §6.5): the accepted
 * Candidate Source, never the assembled Document Source.
 */
export interface DocumentRefineInput {
  candidate: string;
  commentary?: string;
  feedback: string;
}

/** A DOCUMENT draft (spec §7.5), INITIAL or REFINE. */
export interface DocumentGenerateInput
  extends SessionAffinity, RunTimeLeft, RunDate {
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
  /** REFINE only: the base the model rewrites. */
  refine?: DocumentRefineInput;
}

/**
 * One static or render Repair (spec §7.2). The system message is the draft's,
 * so `fragment` and `includeTitle` must be the draft's too.
 */
export interface DocumentRepairInput extends SessionAffinity, RunTimeLeft {
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

/**
 * A `patch`-mode Repair's answer: edits to the Candidate Source, or the whole
 * of it. Neither is checked or applied here.
 */
export type DocumentPatchRepairResult = (
  | { edits: CandidateEdit[] }
  | { html: string }
) & { envelopeRepairs: number };

/**
 * The warm follow-up to a `patch`-mode Repair whose edits did not apply: the
 * same Repair, the edits the model answered with, and why they failed.
 */
export interface DocumentRepairFallbackInput extends DocumentRepairInput {
  edits: CandidateEdit[];
  /** From `applyEdits`; short, and safe to send to the model. */
  problems: string[];
}

export interface ArtifactGenerationResult {
  title?: string;
  content: ArtifactContent;
}

// One LLM turn's usage, tagged with the model that produced it. The step needs
// the model to fill `UsageDetail`, and Layer 1's `Usage` does not carry it.
export interface AgentTurnUsage extends Usage {
  model: string;
  /** Why the turn stopped (`stop`, `length`, ...), when the provider said. */
  finishReason?: string;
  /** DOCUMENT: which call the turn was. */
  call?: DocumentModelCall;
}

/**
 * A DOCUMENT model call: the draft, a Repair, a `patch`-mode Repair's `{ html }`
 * fallback, or the one Zod repair turn any of them may spend on an invalid
 * envelope.
 */
export type DocumentModelCall = 'draft' | 'repair' | 'fallback' | 'envelope';

/**
 * `AgentRunner` must not hold the meter, so usage leaves it through hooks the
 * step bridges to `ctx.meter`. Live per-turn emission is what lets the SSE
 * stream show a climbing credit count during a long run.
 */
export interface AgentHooks {
  onUsage?: (usage: AgentTurnUsage) => void;
  // Fired by the research tool loop (#112); `generate` calls no tools.
  onToolCall?: (tool: { name: string }) => void;
  /**
   * `generate` with `STREAM_POST_COMMENTARY` on: the commentary written so
   * far, on each piece of text the model sends. Repeats a value when a piece
   * did not change it.
   */
  onCommentary?: (commentary: string) => void;
  /**
   * `generate` while streaming: the draft failed validation and the repair
   * turn will write the commentary again, so what was seen so far is void.
   */
  onRewrite?: () => void;
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
  /**
   * One `patch`-mode Repair, answered with edits or with the whole Candidate
   * Source. Throws as `generateDocument` does.
   */
  repairDocumentPatch(
    input: DocumentRepairInput,
    hooks?: AgentHooks,
  ): Promise<DocumentPatchRepairResult>;
  /**
   * The `{ html }` follow-up to a `patch`-mode Repair whose edits did not
   * apply, in the same conversation. Throws as `generateDocument` does.
   */
  repairDocumentFallback(
    input: DocumentRepairFallbackInput,
    hooks?: AgentHooks,
  ): Promise<DocumentRepairResult>;
}
