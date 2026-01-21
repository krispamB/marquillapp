import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { ContentType } from 'src/workflow/workflow.constants';

export class InputDto {
  @IsNotEmpty()
  @IsString()
  input: string;

  @IsNotEmpty()
  @IsEnum(ContentType)
  contentType: ContentType;
}
