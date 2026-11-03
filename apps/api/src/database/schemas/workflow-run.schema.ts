import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from './user.schema';
import { Artifact } from './artifact.schema';
import type { UsageRecord } from '../../feature-gating/credit-meter.constants';
import type { ResearchResult } from '../../agent/agent-runner.interface';
import type { RenderAttemptUsage } from '../../document-render/render-usage.types';
// Type-only, and to the leaf module rather than the engine barrel: the engine
// imports RunKind from here, so a value import either way would be a cycle.
import type {
  AcceptedCandidate,
  BuildInput,
  DocumentCheck,
  DocumentDiagnostics,
  RunLlmUsage,
} from '../../workflow/engine/workflow.types';
import { FailureCode, WorkflowStep } from '../../workflow/workflow.constants';

/** The checkpoint as the run keeps it: the hash, not the text. */
export type StoredAcceptedCandidate = Omit<AcceptedCandidate, 'candidate'> & {
  candidateSha256: string;
};

export enum RunKind {
  INITIAL = 'INITIAL',
  REFINE = 'REFINE',
}

export enum RunStatus {
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

/**
 * One durable record per generation, 1:1 with a BullMQ job. `_id` is the runId,
 * the BullMQ jobId, and the `workflow:run:{runId}` Redis stream key suffix — one
 * identity across run, job, and stream.
 *
 * It never copies generated content; that lives on the artifact version. The run
 * holds only the `(artifact, targetVersion)` reference, which is what makes a
 * whole-job retry overwrite rather than append.
 */
@Schema({ timestamps: true })
export class WorkflowRun extends Document {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  user: User | Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: Artifact.name, required: true })
  artifact: Artifact | Types.ObjectId;

  @Prop({ required: true })
  targetVersion: number;

  @Prop({ required: true, enum: RunKind })
  kind: RunKind;

  @Prop({ required: true, enum: RunStatus, default: RunStatus.RUNNING })
  status: RunStatus;

  // Stored loosely, like ArtifactVersion.content: the engine owns the typed
  // shape and re-derives the step list from it on an SSE cold start.
  @Prop({ type: Object, required: true })
  input: BuildInput;

  // Updated at each step boundary — the SSE cold-start fallback when the Redis
  // stream has expired but the run record has not.
  @Prop({ enum: WorkflowStep })
  currentStep?: WorkflowStep;

  // Persisted when RESEARCH completes; a later refine reads it instead of
  // paying for a second Tavily pass.
  @Prop({ type: Object })
  researchContext?: ResearchResult;

  // What researching recorded on the credit meter (each LLM turn and search),
  // saved with `researchContext`. A job retry replays it so the retried run
  // bills like an unretried one without searching again.
  @Prop({ type: [Object] })
  researchUsage?: UsageRecord[];

  @Prop({ type: [Object], default: [] })
  renderAttempts: RenderAttemptUsage[];

  // DOCUMENT only: every check of a Candidate Source, static or render, with
  // its full violation list. Violation details live here and nowhere else:
  // never in events and never in logs.
  @Prop({ type: [Object], default: undefined })
  documentChecks?: DocumentCheck[];

  // DOCUMENT only: the job's one checkpoint, the latest statically clean
  // Candidate Source RENDER_PDF was about to render. A job retry resumes from
  // it instead of calling the model again. Its text lives, and expires, in
  // `run_candidate_sources`.
  @Prop({ type: Object })
  acceptedCandidate?: StoredAcceptedCandidate;

  // DOCUMENT only: what the run did, written when it ends (spec §11.1).
  @Prop({ type: Object })
  documentDiagnostics?: DocumentDiagnostics;

  // What the final job attempt's model calls cost, written with the run's
  // completion or failure.
  @Prop({ type: Object })
  llmUsage?: RunLlmUsage;

  // The first job attempt's wait between enqueue and worker pickup.
  @Prop()
  queueWaitMs?: number;

  // Attempt-scoped: reset at the start of each attempt so a whole-job retry
  // cannot double-count. Only the winning attempt's total is ever debited.
  @Prop({ required: true, default: 0 })
  creditsUsed: number;

  @Prop({ enum: FailureCode })
  failureCode?: FailureCode;

  @Prop()
  failureReason?: string;
}

export const WorkflowRunSchema = SchemaFactory.createForClass(WorkflowRun);

// Refine seeds `research` from the artifact's latest COMPLETED run.
WorkflowRunSchema.index({ artifact: 1, status: 1, createdAt: -1 });
