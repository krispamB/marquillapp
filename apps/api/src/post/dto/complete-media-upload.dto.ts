import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';
import { MAX_MEDIA_FILES_PER_UPLOAD } from './initiate-media-upload.dto';

export class CompleteMediaUploadDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_MEDIA_FILES_PER_UPLOAD)
  @IsString({ each: true })
  mediaIds: string[];
}
