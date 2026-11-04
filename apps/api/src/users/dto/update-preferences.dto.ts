import { IsEnum, IsOptional, IsTimeZone, ValidateIf } from 'class-validator';
import { ThemePreference } from '../../database/schemas/user.schema';

export class UpdatePreferencesDto {
  @IsOptional()
  @IsEnum(ThemePreference)
  theme?: ThemePreference;

  /** An IANA timezone name, or `null` to go back to the browser's timezone. */
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsTimeZone()
  timezone?: string | null;
}
