import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ArtifactType } from 'src/database/schemas';
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

  // DOCUMENT only: the Design System slug. Omitted means the default; whether
  // it is selectable is checked against the live set at kickoff.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  designSystemId?: string;
}
