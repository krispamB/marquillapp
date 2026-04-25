import { IsEnum } from 'class-validator';
import { UserType } from '../../database/schemas';

export class InitOnboardingDto {
  @IsEnum(UserType)
  userType: UserType;
}
