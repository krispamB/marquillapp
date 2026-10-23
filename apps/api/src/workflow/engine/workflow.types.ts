import type { Logger } from '@nestjs/common';
import type { ArtifactType, RunKind } from '../../database/schemas';
import type { ArtifactContent, DocumentVersion } from '../../artifact/schemas';
import type {
  ArtifactWriter,
  RefineContext,
} from '../../artifact/artifact-writer.interface';
import type {
  AgentRunner,
  DocumentModelCall,
  ResearchResult,
} from '../../agent/agent-runner.interface';
import type { StylePreset } from '../../agent/style-presets.config';
import type { UsageRecord } from '../../feature-gating/credit-meter.constants';
import type { Usage } from '../../llm/interfaces';
import type { RenderAttemptUsage } from '../../document-render/render-usage.types';
import type { RenderSessionResult } from '../../document-render/render-session';
import type { DesignSystemDefinition } from '../../design-system/design-system-definition';
import type { DesignSystemRecord } from '../../design-system/design-systems.service';
import type { Violation } from '../../document-source/violation';
import { FailureCode, WorkflowStep } from '../workflow.constants';
import type { EmittedEvent } from './run-event.types';

export interface WorkflowDefinition {
  name: string;
  steps: WorkflowStep[];
}

/** The three axes the step list varies on. Everything else is shared. */
export interface BuildSpec {
  type: ArtifactType;
  withResearch: boolean;
  kind: RunKind;
}

/** The BullMQ job payload, and the seed of `RunState`. */
export interface BuildInput extends BuildSpec {
  prompt: string;
  stylePreset?: StylePreset;
  /**
   * DOCUMENT only: the Design System Version this Attempt is pinned to,
   * stamped server-side at kickoff so every job attempt renders against the
   * same definition.
   */
  designSystem?: DesignSystemPin;
  userId: string;
  artifactId: string;
  version: number;
}

/** A per-version Design System pin (spec §6.3). */
export interface DesignSystemPin {
  id: string;
  version: number;
}

/** The pinned Design System, loaded by `RESOLVE_INPUT` for a DOCUMENT run. */
export interface ResolvedDesignSystem {
  definition: DesignSystemDefinition;
  /** The memoised prompt fragment for the pinned version. */
  fragment: string;
}

/** What `GENERATE` hands `RENDER_PDF` for a DOCUMENT: the Candidate Source. */
export interface DocumentDraftState {
  commentary: string;
  candidate: string;
  /** Turns of `DOCUMENT_REPAIR_BUDGET` already spent in this job attempt. */
  repairsSpent: number;
}

/**
 * DOCUMENT: the job's only checkpoint (spec §7.3). `RENDER_PDF` saves the
 * latest statically clean Candidate Source before it renders it, so a job
 * retry after a render outage resumes from it without calling the model.
 */
export interface AcceptedCandidate extends DocumentDraftState {
  /** The draft's title, on an INITIAL run. */
  title?: string;
  savedAt: Date;
}

/**
 * One check of a Candidate Source, recorded on the run with its full violation
 * list (spec §6.2): the only place violation details are kept.
 */
export interface DocumentCheck {
  phase: 'static' | 'render';
  /** SHA-256 of the Candidate Source that was checked. */
  candidateSha256: string;
  violations: Violation[];
  checkedAt: Date;
}

/** A lowercase hex SHA-256 of a Candidate Source, its only identity here. */
export type CandidateSha256 = string;

/** A violation `code`: a Definition key path or an `envelope.*` code. */
export type ViolationCode = Violation['code'];

/** How one check of a Candidate Source ended: codes and counts, no details. */
export interface CheckOutcome {
  phase: DocumentCheck['phase'];
  passed: boolean;
  /** Violations counted per `code`, in first-seen order. */
  violations: { code: ViolationCode; count: number }[];
}

/** Every check one Candidate Source went through, passes included. */
export interface CandidateDiagnostics {
  candidateSha256: CandidateSha256;
  checks: CheckOutcome[];
}

/**
 * A job attempt that ended in failure. `message` is the error's own text,
 * which can quote model output: it lives here, never in the logs.
 */
export interface JobAttemptFailure {
  jobAttempt: number;
  failureCode: FailureCode;
  message: string;
}

/** One DOCUMENT model call, as the run's diagnostics keep it. */
export interface ModelTurn {
  model: string;
  call?: DocumentModelCall;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens?: number;
  cachedTokens?: number;
  latencyMs?: number;
  finishReason?: string;
}

/**
 * DOCUMENT: what one run did, across every job attempt (spec §11.1). The
 * worker writes it when a job attempt fails and when the run ends, and the
 * next job attempt carries it on. Candidate Source text is kept apart and
 * expires; this block is kept indefinitely.
 */
export interface DocumentDiagnostics {
  /** The latest BullMQ job attempt, one-based. */
  jobAttempt: number;
  /** Absent only when the job carried no pin, a wiring bug. */
  pin?: DesignSystemPin;
  /** `RETRYING` until a job attempt ends the run. */
  outcome: 'READY' | 'FAILED' | 'RETRYING';
  /** The run's final code, the same one its record and Attempt store. */
  failureCode?: FailureCode;
  /** Every job attempt that failed, the final one included. */
  jobAttemptFailures: JobAttemptFailure[];
  /** In the order they were first checked. */
  candidates: CandidateDiagnostics[];
  /** Turns of `DOCUMENT_REPAIR_BUDGET` the latest job attempt had spent. */
  repairRounds: number;
  /** The last model turn's. */
  finishReason?: string;
  /** Completion tokens over every model turn of every job attempt. */
  outputTokens: number;
  /** Prompt tokens over every model turn of every job attempt. */
  promptTokens: number;
  /** The share of `outputTokens` the model spent reasoning. */
  reasoningTokens: number;
  /** The share of `promptTokens` read from the provider's prompt cache. */
  cachedPromptTokens: number;
  /**
   * Every model call of every job attempt, oldest first, bounded to the
   * latest `MAX_MODEL_TURNS`.
   */
  modelTurns: ModelTurn[];
  pageCount?: number;
  /** Summed over job attempts. */
  stepWallTimeMs: Partial<Record<WorkflowStep, number>>;
  /** Summed over job attempts. */
  wallTimeMs: number;
  /**
   * A reference, not a copy: the run's `renderAttempts` holds every session
   * of the run, and `sessions` is how many of them these diagnostics saw.
   */
  renderAttempts: { sessions: number };
  /** The run's `acceptedCandidate` checkpoint, by hash. */
  acceptedCandidate?: {
    candidateSha256: CandidateSha256;
    repairsSpent: number;
  };
  /**
   * On failure, the last Candidate Source checked or checkpointed, by hash;
   * its text is kept apart and expires.
   */
  failedCandidate?: { candidateSha256: CandidateSha256 };
  /** What the latest job attempt metered; committed only when `READY`. */
  credits: number;
  recordedAt: Date;
}

/**
 * DOCUMENT: the steps' half of the run's diagnostics. Every call is
 * synchronous and in-memory; the worker writes the result.
 */
export interface RunDiagnostics {
  stepStarted(step: WorkflowStep): void;
  stepCompleted(step: WorkflowStep): void;
  recordModelTurn(turn: ModelTurn): void;
  recordCheck(
    phase: DocumentCheck['phase'],
    candidate: string,
    violations: Violation[],
  ): void;
  /** The job attempt's running total, as it changes. */
  recordRepairsSpent(repairsSpent: number): void;
  recordAccepted(candidate: string, repairsSpent: number): void;
  recordRenderSession(): void;
  recordPageCount(pageCount: number): void;
}

/**
 * One state object with typed, named optional slots. The step list is assembled
 * dynamically, so TypeScript cannot infer a chained input→output pipeline;
 * instead each step reads the slots it needs and writes only its own.
 */
export interface RunState {
  input: BuildInput;
  research?: ResearchResult;
  refine?: RefineContext;
  generatedTitle?: string;
  /** POST and POLL: the generated content. */
  content?: ArtifactContent;
  /** DOCUMENT: the pinned Design System. */
  designSystem?: ResolvedDesignSystem;
  /**
   * DOCUMENT REFINE: the base's Candidate Source, read from R2 and verified
   * against its `candidateSha256` (spec §6.5).
   */
  baseCandidate?: string;
  /** DOCUMENT: the statically clean Candidate Source and its commentary. */
  draft?: DocumentDraftState;
  /** DOCUMENT: the uploaded Document Version, without its commentary. */
  document?: DocumentVersion;
}

/**
 * A step returns a patch the engine shallow-merges, rather than mutating state
 * in place. The patch gives the event layer a clean "here is what this step
 * produced" hook.
 */
export type StepHandler = (
  state: RunState,
  ctx: StepContext,
) => Promise<Partial<RunState>>;

export type StepHandlerMap = Partial<Record<WorkflowStep, StepHandler>>;

/**
 * DOCUMENT-only: one render session (spec §5.1) against Browserless. It
 * measures and never decides; `RENDER_PDF` judges the facts.
 */
export interface DocumentRenderer {
  /**
   * One render session. It first waits up to `maxSlotWaitMs` for a Browserless
   * slot, and throws `RenderSlotUnavailableError` without a session if none
   * comes free.
   */
  render(
    definition: DesignSystemDefinition,
    documentSource: string,
    options?: { maxSlotWaitMs?: number },
  ): Promise<RenderSessionResult>;
}

/** DOCUMENT-only: the private object store a Document Version lives in. */
export interface DocumentObjectStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** The object's bytes, or `null` when it does not exist. */
  get(key: string): Promise<Buffer | null>;
}

/** DOCUMENT-only: status-blind reads of an exact Design System Version. */
export interface DesignSystemResolver {
  resolve(id: string, version: number): Promise<DesignSystemRecord>;
}

/**
 * The engine-side half of credit accounting: an attempt-scoped accumulator over
 * `CreditMeterService`'s pure conversion. `record` is synchronous — it both
 * accounts and announces (`usage.tick`), so `ctx.emit` is reserved for
 * `step.progress`.
 */
export interface CreditMeter {
  readonly creditsUsed: number;
  /** The run owner is bound at construction, so neither call re-states it. */
  assertBalance(): Promise<void>;
  record(usage: UsageRecord): void;
  /** Reset at the start of each attempt so a whole-job retry cannot double-count. */
  reset(): void;
  /** The only real debit. Best-effort: never fails a completed run. */
  commit(): Promise<void>;
}

/**
 * What one job attempt's model calls cost, summed. Written with the run's
 * completion or failure; like `creditsUsed`, it describes the final attempt.
 */
export interface RunLlmUsage {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  /** Wall time spent waiting on the model, summed over the calls. */
  llmMs: number;
}

/** Research a run finished, and the usage it recorded while doing so. */
export interface SavedResearch {
  research: ResearchResult;
  usage: UsageRecord[];
}

/** The durable run record, narrowed to what the engine and its steps write. */
export interface RunRecordHandle {
  readonly runId: string;
  /** `usage` is what researching recorded, kept so a job retry can bill it again. */
  saveResearchContext(
    research: ResearchResult,
    usage: UsageRecord[],
  ): Promise<void>;
  /** The research an earlier job attempt of this run finished, with its usage. */
  readResearchContext(): Promise<SavedResearch | undefined>;
  recordRenderAttempt(usage: RenderAttemptUsage): Promise<void>;
  recordDocumentCheck(check: DocumentCheck): Promise<void>;
  saveAcceptedCandidate(accepted: AcceptedCandidate): Promise<void>;
  /** The checkpoint an earlier job attempt of this run saved, if any. */
  readAcceptedCandidate(): Promise<AcceptedCandidate | undefined>;
  /** DOCUMENT: what earlier job attempts of this run recorded, if any. */
  readDocumentDiagnostics(): Promise<DocumentDiagnostics | undefined>;
  /**
   * DOCUMENT: the run's diagnostics and, on failure, the text of its failed
   * Candidate Source, which is kept apart so it expires.
   */
  saveDocumentDiagnostics(
    diagnostics: DocumentDiagnostics,
    failedCandidateSource?: string,
  ): Promise<void>;
  getLatestCompletedResearch(
    artifactId: string,
  ): Promise<ResearchResult | undefined>;
  /** The time from enqueue to the worker picking the job up. */
  recordQueueWait(queueWaitMs: number): Promise<void>;
  /**
   * Tallies one model call in memory. `complete` and `fail` on the same
   * handle write the sum as `llmUsage`, in the update they already make.
   */
  recordModelCall(usage: Usage): void;
  /**
   * DOCUMENT REFINE: the kept text of an ACCEPTED Candidate Source with this
   * hash, if any. Unverified: the caller checks the hash.
   */
  readAcceptedCandidateText(
    candidateSha256: string,
  ): Promise<string | undefined>;
  complete(creditsUsed: number): Promise<void>;
  /**
   * Fails the run only while it is still `RUNNING`, so a replayed failure
   * neither overwrites the first one nor a completion.
   */
  fail(
    failureCode: FailureCode,
    failureReason: string,
  ): Promise<RunFailOutcome>;
}

/** What `RunRecordHandle.fail` did. */
export type RunFailOutcome = 'FAILED' | 'ALREADY_ENDED';

/**
 * The job attempt's wall-clock bound (spec §7.5), checked before each DOCUMENT
 * model call and render session. Throws transient once it has passed.
 */
export interface RunDeadlineGuard {
  assertTimeLeft(step: WorkflowStep, before: string): void;
  /**
   * Milliseconds left before the deadline, less `reserveMs` (default `0`);
   * never negative.
   */
  remainingMs(reserveMs?: number): number;
}

/**
 * Narrow role interfaces, not concrete services — every step mocks as trivially
 * as any other under the repo's manual-construction test style.
 */
export interface StepContext {
  logger: Logger;
  agent: AgentRunner;
  artifacts: ArtifactWriter;
  meter: CreditMeter;
  designSystems: DesignSystemResolver;
  renderer: DocumentRenderer;
  objects: DocumentObjectStore;
  deadline: RunDeadlineGuard;
  diagnostics: RunDiagnostics;
  /** `step.progress` only. Lifecycle events are the core's job. */
  emit: (event: EmittedEvent) => void;
  run: RunRecordHandle;
}
