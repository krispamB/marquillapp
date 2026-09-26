import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Tier } from './tier.schema';

@Schema({ timestamps: true })
export class User extends Document {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, unique: true })
  email: string;

  @Prop()
  googleId?: string;

  @Prop()
  clerkId?: string;

  @Prop()
  avatar?: string;

  @Prop({
    type: Types.ObjectId,
    ref: Tier.name,
    required: true,
  })
  tier?: Tier | Types.ObjectId;
}

export const UserSchema = SchemaFactory.createForClass(User);

export const USER_GOOGLE_ID_INDEX_NAME = 'user_google_id_unique';
export const USER_CLERK_ID_INDEX_NAME = 'user_clerk_id_unique';

UserSchema.index(
  { googleId: 1 },
  {
    name: USER_GOOGLE_ID_INDEX_NAME,
    unique: true,
    partialFilterExpression: { googleId: { $type: 'string' } },
  },
);

UserSchema.index(
  { clerkId: 1 },
  {
    name: USER_CLERK_ID_INDEX_NAME,
    unique: true,
    partialFilterExpression: { clerkId: { $type: 'string' } },
  },
);
