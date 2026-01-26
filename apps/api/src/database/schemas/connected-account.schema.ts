import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { User } from './user.schema';

export enum AccountProvider {
  LINKEDIN = 'LINKEDIN',
  MEDIUM = 'MEDIUM',
}

@Schema({ timestamps: true })
export class ConnectedAccount extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user: User;

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
