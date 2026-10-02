import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from './user.schema';
import { StylePreset } from '../../agent/style-presets.config';
import { FailureCode } from '../../workflow/workflow.constants';

export enum ArtifactType {
  POST = 'POST',
  POLL = 'POLL',
  DOCUMENT = 'DOCUMENT',
}

export enum VersionStatus {
  GENERATING = 'GENERATING',
  READY = 'READY',
  FAILED = 'FAILED',
}

// Visual theme of a DOCUMENT carousel — distinct from the writing-voice StylePreset.
export enum CarouselTheme {
  BOLD = 'bold',
  MINIMAL = 'minimal',
  EDITORIAL = 'editorial',
  GRADIENT = 'gradient',
}

@Schema({ _id: false })
export class ArtifactSource {
  @Prop({ required: true })
  prompt: string;

  @Prop({ required: true })
  withResearch: boolean;

  @Prop({ enum: StylePreset })
  stylePreset?: StylePreset;

  @Prop({ enum: CarouselTheme })
  theme?: CarouselTheme;
}

export const ArtifactSourceSchema =
  SchemaFactory.createForClass(ArtifactSource);

/**
 * One version of an Artifact. Until it is `READY` it is an Attempt: content-less
 * while `GENERATING`, and kept content-less forever once `FAILED`.
 */
@Schema({ _id: false })
export class ArtifactVersion {
  /** `max(versions) + 1` when appended; never reused. */
  @Prop({ required: true })
  version: number;

  @Prop({ required: true, enum: VersionStatus })
  status: VersionStatus;

  // Present only once READY. Stored loosely; Zod-validated against the
  // per-type content union at the app boundary.
  @Prop({ type: Object })
  content?: Record<string, unknown>;

  @Prop()
  refineFeedback?: string;

  /** The Current Version a refine started from; absent on v1. */
  @Prop()
  parentVersion?: number;

  @Prop()
  editedAt?: Date;

  @Prop({ enum: FailureCode })
  failureCode?: FailureCode;

  @Prop()
  failureReason?: string;

  @Prop({ required: true, default: () => new Date() })
  createdAt: Date;
}

export const ArtifactVersionSchema =
  SchemaFactory.createForClass(ArtifactVersion);

@Schema({ timestamps: true })
export class Artifact extends Document {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  user: User | Types.ObjectId;

  @Prop({ required: true, enum: ArtifactType })
  type: ArtifactType;

  @Prop()
  title?: string;

  @Prop({ type: ArtifactSourceSchema, required: true })
  source: ArtifactSource;

  /**
   * The newest READY version. Absent until the first version is READY, and
   * moved only by the promotion write that sets READY.
   */
  @Prop()
  currentVersion?: number;

  // Scheduling/publishing increments this revision so an in-flight editor
  // cannot mutate a version after it becomes pinned.
  @Prop({ required: true, default: 0 })
  pinRevision: number;

  @Prop({ type: [ArtifactVersionSchema], default: [] })
  versions: ArtifactVersion[];

  @Prop()
  deletedAt?: Date;
}

export const ArtifactSchema = SchemaFactory.createForClass(Artifact);
