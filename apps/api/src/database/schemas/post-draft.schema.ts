import { Prop, raw, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from './user.schema';
import { ConnectedAccount } from './connected-account.schema';
import { ContentType } from '../../workflow/workflow.constants';
import type {
  CompressionResult,
  UserIntent,
  YoutubeSearchResult,
} from '../../agent/agent.interface';

export enum PostDraftStatus {
  DRAFT = 'DRAFT',
  SCHEDULED = 'SCHEDULED',
  PUBLISHED = 'PUBLISHED',
}

@Schema({ timestamps: true })
export class PostDraft extends Document {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  user: User | Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: ConnectedAccount.name,
    required: true,
  })
  connectedAccount: ConnectedAccount | Types.ObjectId;

  @Prop({ required: true, enum: ContentType })
  type: ContentType;

  @Prop({
    required: true,
    enum: PostDraftStatus,
    default: PostDraftStatus.DRAFT,
  })
  status: PostDraftStatus;

  @Prop()
  content?: string;

  @Prop(
    raw([
      {
        id: { type: String, required: true },
        title: { type: String },
        altText: { type: String },
      },
    ]),
  )
  media?: {
    id: string;
    title?: string;
    altText?: string;
  }[];

  @Prop({ type: Array<object> })
  youtubeResearch?: YoutubeSearchResult[];

  @Prop({ type: Object })
  userIntent?: UserIntent;

  @Prop({ type: Object })
  compressionResult?: CompressionResult;

  @Prop()
  channelPostId?: string;

  @Prop()
  scheduledAt?: Date;

  @Prop()
  publishedAt?: Date;
}

export const PostDraftSchema = SchemaFactory.createForClass(PostDraft);
