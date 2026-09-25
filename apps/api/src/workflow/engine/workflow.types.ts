import type { Logger } from '@nestjs/common';
import type {
  ArtifactType,
  CarouselTheme,
  RunKind,
} from '../../database/schemas';
import type { ArtifactContent } from '../../artifact/schemas';
import type {
  ArtifactWriter,
  RefineContext,
  VersionRender,
} from '../../artifact/artifact-writer.interface';
import type {
  AgentRunner,
  ResearchResult,
} from '../../agent/agent-runner.interface';
import type { StylePreset } from '../../agent/style-presets.config';
import type { UsageRecord } from '../../feature-gating/credit-meter.constants';
import type { RenderAttemptUsage } from '../../carousel/render-usage.types';
import { WorkflowStep } from '../workflow.constants';
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
  theme?: CarouselTheme;
  userId: string;
  artifactId: string;
  version: number;
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
  content?: ArtifactContent;
  render?: VersionRender;
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

/** DOCUMENT-only. `CarouselRendererService` (#121) consumes it. */
export interface CarouselRenderInput {
  artifactId: string;
  version: number;
  templateId: CarouselTheme;
  // Typed with the DOCUMENT content arm (#122). The engine never inspects them.
  slides: unknown[];
}

export interface CarouselRenderer {
  render(input: CarouselRenderInput): Promise<VersionRender>;
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
  getLatestCompletedResearch(
    artifactId: string,
  ): Promise<ResearchResult | undefined>;
  complete(creditsUsed: number): Promise<void>;
  fail(failureReason: string): Promise<void>;
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
  renderer: CarouselRenderer;
  /** `step.progress` only. Lifecycle events are the core's job. */
  emit: (event: EmittedEvent) => void;
  run: RunRecordHandle;
}
