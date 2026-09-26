import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from './user.schema';
import { Artifact } from './artifact.schema';
import type { ResearchResult } from '../../agent/agent-runner.interface';
import type { RenderAttemptUsage } from '../../carousel/render-usage.types';
// Type-only, and to the leaf module rather than the engine barrel: the engine
// imports RunKind from here, so a value import either way would be a cycle.
import type { BuildInput } from '../../workflow/engine/workflow.types';
import { WorkflowStep } from '../../workflow/workflow.constants';

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

  @Prop({ type: [Object], default: [] })
  renderAttempts: RenderAttemptUsage[];

  // Attempt-scoped: reset at the start of each attempt so a whole-job retry
  // cannot double-count. Only the winning attempt's total is ever debited.
  @Prop({ required: true, default: 0 })
  creditsUsed: number;

  @Prop()
  failureReason?: string;
}

export const WorkflowRunSchema = SchemaFactory.createForClass(WorkflowRun);

// Refine seeds `research` from the artifact's latest COMPLETED run.
WorkflowRunSchema.index({ artifact: 1, status: 1, createdAt: -1 });
