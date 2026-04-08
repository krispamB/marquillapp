import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ContentType } from '../../workflow/workflow.constants';
import { StylePreset } from '../style-presets.config';

export class InputDto {
  @IsNotEmpty()
  @IsString()
  input: string;

  @IsNotEmpty()
  @IsEnum(ContentType)
  contentType: ContentType;

  @IsOptional()
  @IsEnum(StylePreset)
  stylePreset?: StylePreset;
}
