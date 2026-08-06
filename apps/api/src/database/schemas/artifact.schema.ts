import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from './user.schema';
import { StylePreset } from '../../agent/style-presets.config';

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

@Schema({ _id: false })
export class ArtifactVersion {
  @Prop({ required: true })
  version: number;

  @Prop({ required: true, enum: VersionStatus })
  status: VersionStatus;

  // Stored loosely; Zod-validated against the per-type content union at the app boundary.
  @Prop({ type: Object, default: {} })
  content: Record<string, unknown>;

  @Prop()
  refineFeedback?: string;

  @Prop()
  editedAt?: Date;

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

  @Prop({ required: true })
  currentVersion: number;

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
