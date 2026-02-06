import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class Tier extends Document {
    @Prop({ required: true, unique: true })
    name: string;

    @Prop({ default: 0 })
    monthlyPrice: number;

    @Prop({ default: 0 })
    yearlyPrice: number;

    @Prop({ default: false })
    isDefault: boolean;

    @Prop({ default: true })
    isActive: boolean;

    @Prop({ type: Object })
    metadata?: Record<string, any>;
}

export const TierSchema = SchemaFactory.createForClass(Tier);
