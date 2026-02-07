import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { User } from './user.schema';
import { PaymentProvider } from './subscription.schema';

@Schema({ timestamps: true })
export class BillingCustomer extends Document {
    @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
    user: User;

    @Prop({ required: true, enum: PaymentProvider })
    provider: PaymentProvider;

    @Prop({ required: true })
    providerCustomerId: string;

    @Prop({ type: Object })
    metadata?: Record<string, any>;
}

export const BillingCustomerSchema =
    SchemaFactory.createForClass(BillingCustomer);
