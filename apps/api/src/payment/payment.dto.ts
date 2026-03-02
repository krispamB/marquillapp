import { IsEnum } from 'class-validator';
import { BillingInterval } from '../database/schemas/subscription.schema';

export class CreateCheckoutDto {
  @IsEnum(BillingInterval)
  billingInterval: BillingInterval;
}
