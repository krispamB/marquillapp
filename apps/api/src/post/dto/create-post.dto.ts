import {
  IsInt,
  IsMongoId,
  IsOptional,
  IsPositive,
} from 'class-validator';
import { IsContentTitle } from '../../common/decorators';

export class CreatePostDto {
  @IsContentTitle()
  title?: string;

  @IsMongoId()
  artifactId: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  version?: number;

  @IsMongoId()
  connectedAccount: string;
}
