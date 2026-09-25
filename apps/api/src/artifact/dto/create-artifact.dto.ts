import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ArtifactType, CarouselTheme } from 'src/database/schemas';
import { StylePreset } from 'src/agent/style-presets.config';

/**
 * `POST /artifacts` body. No `connectedAccount` — an artifact is
 * account-agnostic until it is bound to an account and posted.
 */
export class CreateArtifactDto {
  @IsEnum(ArtifactType)
  type: ArtifactType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  prompt: string;

  @IsBoolean()
  withResearch: boolean;

  // Writing voice — applies to any artifact type (R4).
  @IsOptional()
  @IsEnum(StylePreset)
  stylePreset?: StylePreset;

  // Carousel look — meaningful only for DOCUMENT artifacts (R4).
  @IsOptional()
  @IsEnum(CarouselTheme)
  theme?: CarouselTheme;
}
