import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsMongoId, IsOptional } from 'class-validator';
import { ANALYTICS_RANGE_KEYS, type AnalyticsRangeKey } from '../interfaces';

/** `refresh=true` is the only truthy spelling; anything else but `false` is a 400. */
function toBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
}

export class AnalyticsAccountParamsDto {
  @IsMongoId()
  connectedAccountId: string;
}

export class AnalyticsRefreshQueryDto {
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  refresh?: boolean;
}

export class AnalyticsRangeQueryDto extends AnalyticsRefreshQueryDto {
  @IsOptional()
  @IsIn(ANALYTICS_RANGE_KEYS)
  range?: AnalyticsRangeKey;
}
