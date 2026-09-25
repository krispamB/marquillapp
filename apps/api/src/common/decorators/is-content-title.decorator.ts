import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { CONTENT_TITLE_MAX_LENGTH } from '../constants';

export function IsContentTitle(): PropertyDecorator {
  return applyDecorators(
    ValidateIf((_object: object, value: unknown) => value !== undefined),
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim() : value,
    ),
    IsString(),
    IsNotEmpty(),
    MaxLength(CONTENT_TITLE_MAX_LENGTH),
  );
}
