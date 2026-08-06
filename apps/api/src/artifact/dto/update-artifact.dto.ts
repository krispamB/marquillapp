import { IsObject, IsOptional } from 'class-validator';
import { IsContentTitle } from '../../common/decorators';

/**
 * PATCH accepts a `{ content: ... }` envelope as well as direct content fields.
 * The latter keeps the HTTP surface convenient for the content editor while
 * the service normalizes both forms before validating the complete payload.
 */
export class UpdateArtifactDto {
  [key: string]: unknown;

  @IsContentTitle()
  title?: string;

  @IsOptional()
  @IsObject()
  content?: Record<string, unknown>;
}
