import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from './user.schema';

export enum AccountProvider {
  LINKEDIN = 'LINKEDIN',
  MEDIUM = 'MEDIUM',
}

export enum LinkedinAccountType {
  PERSON = 'PERSON',
  ORGANIZATION = 'ORGANIZATION',
}

@Schema({ timestamps: true })
export class ConnectedAccount extends Document {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  user: User | Types.ObjectId;

  @Prop({ required: true, enum: AccountProvider })
  provider: AccountProvider;

  @Prop({
    required: true,
    enum: LinkedinAccountType,
    default: LinkedinAccountType.PERSON,
  })
  accountType: LinkedinAccountType;

  @Prop()
  externalId?: string;

  @Prop()
  displayName?: string;

  @Prop()
  avatarUrl?: string;

  @Prop()
  avatarUrlExpiresAt?: Date;

  @Prop()
  impersonatorUrn?: string;

  @Prop({ type: String })
  accessToken?: string | null;

  @Prop()
  accessTokenExpiresAt?: Date;

  /**
   * Token of the second LinkedIn app (Community Management API), held by a
   * `PERSON` account for member analytics. Never selected by default, so it
   * cannot ride along in an account returned to a client.
   */
  @Prop({ type: String, select: false })
  analyticsAccessToken?: string | null;

  @Prop()
  analyticsAccessTokenExpiresAt?: Date;

  @Prop({ type: Object })
  profileMetadata?: Record<string, any>;

  @Prop({ default: true })
  isActive: boolean;
}

export const ConnectedAccountSchema =
  SchemaFactory.createForClass(ConnectedAccount);

ConnectedAccountSchema.index(
  { user: 1, provider: 1, accountType: 1, externalId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      externalId: { $exists: true, $type: 'string' },
    },
  },
);

ConnectedAccountSchema.index(
  { provider: 1, accountType: 1, externalId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      provider: AccountProvider.LINKEDIN,
      accountType: LinkedinAccountType.PERSON,
      externalId: { $exists: true, $type: 'string', $ne: '' },
    },
  },
);
