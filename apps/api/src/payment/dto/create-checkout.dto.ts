import { IsString, Matches } from 'class-validator';

export class CreateCheckoutDto {
  @IsString()
  @Matches(/^pri_[a-z\d]{26}$/, {
    message: 'priceId must be a valid Paddle price ID',
  })
  priceId: string;
}
