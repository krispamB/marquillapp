import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { ArtifactType, VersionStatus } from 'src/database/schemas';

export class ListArtifactsQueryDto {
  @IsOptional()
  @IsEnum(ArtifactType)
  type?: ArtifactType;

  @IsOptional()
  @IsEnum(VersionStatus)
  status?: VersionStatus;

  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const search = value.trim();
    return search.length > 0 ? search : undefined;
  })
  @IsString()
  @MaxLength(2000)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}

export class GetArtifactQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;

  @IsOptional()
  @Transform(
    ({ value }: { value: unknown }) => value === true || value === 'true',
  )
  includeVersions?: boolean;
}
