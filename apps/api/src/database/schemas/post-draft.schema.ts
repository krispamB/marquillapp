import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { User } from './user.schema';
import { ConnectedAccount } from './connected-account.schema';
import { ContentType } from '../../workflow/workflow.constants';
import type {
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
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user: User;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'ConnectedAccount',
    required: true,
  })
  connectedAccount: ConnectedAccount;

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

  @Prop({ type: Array<object> })
  youtubeResearch?: YoutubeSearchResult[];

  @Prop({ type: Object })
  userIntent?: UserIntent;

  @Prop()
  channelPostId?: string;

  @Prop()
  scheduledAt?: Date;

  @Prop()
  publishedAt?: Date;
}

export const PostDraftSchema = SchemaFactory.createForClass(PostDraft);
