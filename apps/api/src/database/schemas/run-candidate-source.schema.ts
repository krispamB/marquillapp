import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { WorkflowRun } from './workflow-run.schema';

/** Which of a run's Candidate Sources the text is. */
export enum RunCandidateSourceRole {
  /** The `acceptedCandidate` checkpoint (spec §7.3). */
  ACCEPTED = 'ACCEPTED',
  /** The last Candidate Source a failed run checked (spec §11.1). */
  FAILED = 'FAILED',
}

/**
 * The Candidate Source text a DOCUMENT run keeps, apart from the run so it
 * can expire (spec §11.5): Mongo's TTL monitor deletes whole documents, never
 * fields. The run keeps the hash and everything else indefinitely.
 */
@Schema({ collection: 'run_candidate_sources', versionKey: false })
export class RunCandidateSource extends Document {
  @Prop({ type: Types.ObjectId, ref: WorkflowRun.name, required: true })
  run: Types.ObjectId;

  @Prop({ required: true, enum: RunCandidateSourceRole })
  role: RunCandidateSourceRole;

  @Prop({ required: true })
  candidateSha256: string;

  @Prop({ required: true })
  candidate: string;

  @Prop({ required: true })
  expiresAt: Date;
}

export const RunCandidateSourceSchema =
  SchemaFactory.createForClass(RunCandidateSource);

RunCandidateSourceSchema.index({ run: 1, role: 1 }, { unique: true });
RunCandidateSourceSchema.index({ candidateSha256: 1, role: 1 });
RunCandidateSourceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
