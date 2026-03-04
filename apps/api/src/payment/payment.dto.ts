import { IsEnum, IsMongoId } from 'class-validator';
import { BillingInterval } from '../database/schemas/subscription.schema';

export class CreateCheckoutDto {
  @IsMongoId()
  tierId: string;

  @IsEnum(BillingInterval)
  billingInterval: BillingInterval;
}
