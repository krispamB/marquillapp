import type { Logger } from '@nestjs/common';
import type { ArtifactType, RunKind } from '../../database/schemas';
import type { ArtifactContent, DocumentVersion } from '../../artifact/schemas';
import type {
  ArtifactWriter,
  RefineContext,
} from '../../artifact/artifact-writer.interface';
import type {
  AgentRunner,
  ResearchResult,
} from '../../agent/agent-runner.interface';
import type { StylePreset } from '../../agent/style-presets.config';
import type { UsageRecord } from '../../feature-gating/credit-meter.constants';
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
  render(
    definition: DesignSystemDefinition,
    documentSource: string,
  ): Promise<RenderSessionResult>;
}

/** DOCUMENT-only: the private object store a Document Version lives in. */
export interface DocumentObjectStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
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

/** The durable run record, narrowed to what the engine and its steps write. */
export interface RunRecordHandle {
  readonly runId: string;
  setCurrentStep(step: WorkflowStep): Promise<void>;
  saveResearchContext(research: ResearchResult): Promise<void>;
  recordRenderAttempt(usage: RenderAttemptUsage): Promise<void>;
  recordDocumentCheck(check: DocumentCheck): Promise<void>;
  getLatestCompletedResearch(
    artifactId: string,
  ): Promise<ResearchResult | undefined>;
  complete(creditsUsed: number): Promise<void>;
  fail(failureCode: FailureCode, failureReason: string): Promise<void>;
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
  /** `step.progress` only. Lifecycle events are the core's job. */
  emit: (event: EmittedEvent) => void;
  run: RunRecordHandle;
}
