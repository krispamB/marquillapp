import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type Feature = 'ai_drafts' | 'connected_accounts' | 'scheduled_posts';

@Schema({ timestamps: true })
export class Tier extends Document {
  @Prop({ required: true, unique: true })
  name: string;

  @Prop({ default: 0 })
  monthlyPrice: number;

  @Prop({ default: 0 })
  yearlyPrice: number;

  @Prop()
  polarMonthlyPriceId?: string;

  @Prop()
  polarYearlyPriceId?: string;

  @Prop({ default: false })
  isDefault: boolean;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ type: Object })
  limits: Record<Feature, number>;

  @Prop({ type: Object })
  metadata?: Record<string, any>;
}

export const TierSchema = SchemaFactory.createForClass(Tier);
