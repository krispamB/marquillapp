import {
  IsInt,
  IsMongoId,
  IsPositive,
  ValidateIf,
} from 'class-validator';
import { IsContentTitle } from '../../common/decorators';

export class UpdatePostDto {
  @ValidateIf((_object: object, value: unknown) => value !== undefined)
  @IsMongoId()
  artifactId?: string;

  @ValidateIf((_object: object, value: unknown) => value !== undefined)
  @IsInt()
  @IsPositive()
  version?: number;

  @IsContentTitle()
  title?: string;
}
