import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';
import { MAX_MEDIA_FILES_PER_POST } from './initiate-media-upload.dto';

export class CompleteMediaUploadDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_MEDIA_FILES_PER_POST)
  @IsString({ each: true })
  mediaIds: string[];
}
