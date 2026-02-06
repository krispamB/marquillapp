import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Tier } from './tier.schema';

@Schema({ timestamps: true })
export class User extends Document {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ unique: true })
  googleId?: string;

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
