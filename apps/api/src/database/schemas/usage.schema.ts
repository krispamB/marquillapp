import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from './user.schema';

@Schema({ timestamps: true })
export class Usage extends Document {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true, index: true })
  user_id: User | Types.ObjectId;

  @Prop({ required: true, index: true })
  feature: string;

  @Prop({ required: true, default: 0, min: 0 })
  count: number;

  @Prop({ required: true, index: true })
  periodStart: Date;
}

export const UsageSchema = SchemaFactory.createForClass(Usage);

UsageSchema.index(
  { user_id: 1, feature: 1, periodStart: 1 },
  { unique: true, name: 'usage_feature_period_unique' },
);
