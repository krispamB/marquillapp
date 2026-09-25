import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ConnectedAccount } from './connected-account.schema';
import { User } from './user.schema';
import { CONTENT_TITLE_MAX_LENGTH } from '../../common/constants';

export enum PostStatus {
  DRAFT = 'DRAFT',
  SCHEDULED = 'SCHEDULED',
  PUBLISHED = 'PUBLISHED',
  FAILED = 'FAILED',
}

export enum PostMediaType {
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
}

export enum PostMediaStatus {
  PENDING = 'PENDING',
  UPLOADING = 'UPLOADING',
  READY = 'READY',
  FAILED = 'FAILED',
}

@Schema({ _id: false })
export class PostMedia {
  @Prop({ required: true })
  id: string;

  @Prop()
  linkedinUrn?: string;

  @Prop({ required: true, enum: PostMediaType })
  type: PostMediaType;

  @Prop()
  title?: string;

  @Prop()
  altText?: string;

  @Prop({ required: true, enum: PostMediaStatus })
  status: PostMediaStatus;

  @Prop()
  mimeType?: string;

  @Prop()
  sizeBytes?: number;

  @Prop()
  pendingExpiresAt?: Date;
}

export const PostMediaSchema = SchemaFactory.createForClass(PostMedia);

@Schema({ _id: false })
export class PostArtifactReference {
  @Prop({ type: Types.ObjectId, ref: 'Artifact', required: true })
  artifact: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  version: number;
}

export const PostArtifactReferenceSchema = SchemaFactory.createForClass(
  PostArtifactReference,
);

@Schema({ timestamps: true })
export class Post extends Document {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  user: User | Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: ConnectedAccount.name, required: true })
  connectedAccount: ConnectedAccount | Types.ObjectId;

  @Prop({ trim: true, maxlength: CONTENT_TITLE_MAX_LENGTH })
  title?: string;

  @Prop({ type: [PostArtifactReferenceSchema], required: true })
  artifacts: PostArtifactReference[];

  @Prop({ type: [PostMediaSchema], default: [] })
  media: PostMedia[];

  @Prop({ required: true, enum: PostStatus, default: PostStatus.DRAFT })
  status: PostStatus;

  @Prop()
  scheduledAt?: Date;

  @Prop({ default: false })
  scheduledPostUsageCounted: boolean;

  @Prop()
  publishedAt?: Date;

  @Prop()
  channelPostId?: string;

  @Prop()
  failureReason?: string;
}

export const PostSchema = SchemaFactory.createForClass(Post);
