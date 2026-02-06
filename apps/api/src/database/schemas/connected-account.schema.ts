import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from './user.schema';

export enum AccountProvider {
  LINKEDIN = 'LINKEDIN',
  MEDIUM = 'MEDIUM',
}

@Schema({ timestamps: true })
export class ConnectedAccount extends Document {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  user: User | Types.ObjectId;

  @Prop({ required: true, enum: AccountProvider })
  provider: AccountProvider;

  @Prop({ required: true })
  accessToken: string;

  @Prop()
  accessTokenExpiresAt?: Date;

  @Prop({ type: Object })
  profileMetadata?: Record<string, any>;

  @Prop({ default: true })
  isActive: boolean;
}

export const ConnectedAccountSchema =
  SchemaFactory.createForClass(ConnectedAccount);
