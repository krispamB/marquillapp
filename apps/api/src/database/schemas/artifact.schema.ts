import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from './user.schema';
import type { pollArtifact, postArtifact } from 'src/mark/types/artifact.types';

export enum ArtifactType {
  POST = 'post',
  POLL = 'poll',
  DOCUMENT = 'document',
}

@Schema({ timestamps: true })
export class Artifact extends Document {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  user: User | Types.ObjectId;

  @Prop({ required: true, enum: ['html', 'text', 'structured'] })
  type: ArtifactType;

  @Prop({})
  title: string;

  @Prop({ required: true })
  description: string;

  @Prop({ type: Object })
  post?: postArtifact;

  @Prop({ type: Object })
  poll?: pollArtifact;

  @Prop()
  document?: string;
}

export const ArtifactSchema = SchemaFactory.createForClass(Artifact);
