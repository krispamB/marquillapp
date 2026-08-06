import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const MAX_MEDIA_FILE_SIZE_BYTES = 200 * 1024 * 1024;
export const MAX_MEDIA_FILES_PER_POST = 20;

export class MediaUploadFileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName: string;

  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @IsInt()
  @Min(1)
  @Max(MAX_MEDIA_FILE_SIZE_BYTES)
  sizeBytes: number;
}

export class InitiateMediaUploadDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_MEDIA_FILES_PER_POST)
  @ValidateNested({ each: true })
  @Type(() => MediaUploadFileDto)
  files: MediaUploadFileDto[];
}
