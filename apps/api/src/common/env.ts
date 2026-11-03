import { ConfigService } from '@nestjs/config';

export type EnvSource = ConfigService | Record<string, string | undefined>;

export interface IntEnvOptions {
  /** Used when the key is unset or blank. Not range-checked. */
  default: number;
  /** Inclusive lower bound. Defaults to 0, so a negative value never passes. */
  min?: number;
  /** Inclusive upper bound. */
  max?: number;
}

/**
 * Reads an integer setting. Unset or blank gives `options.default`; anything
 * else must be a base-10 integer within `[min, max]`, or this throws an Error
 * naming the key and the value, so a bad setting fails the boot.
 */
export function readIntEnv(
  source: EnvSource,
  key: string,
  options: IntEnvOptions,
): number {
  const raw =
    source instanceof ConfigService
      ? source.get<string | number>(key)
      : source[key];
  const text = raw === undefined || raw === null ? '' : String(raw).trim();
  if (text === '') return options.default;

  const min = options.min ?? 0;
  const { max } = options;
  const bounds = max === undefined ? `>= ${min}` : `>= ${min} and <= ${max}`;
  const value = Number(text);
  if (
    !/^-?\d+$/.test(text) ||
    !Number.isSafeInteger(value) ||
    value < min ||
    (max !== undefined && value > max)
  ) {
    throw new Error(`${key} is "${text}"; it must be an integer ${bounds}`);
  }
  return value;
}

const TRUE_VALUES = new Set(['true', '1']);
const FALSE_VALUES = new Set(['false', '0']);

/**
 * Reads an on/off setting. Unset or blank gives `defaultValue`; `true`/`1`
 * and `false`/`0` (any case) are read as such, and anything else throws an
 * Error naming the key and the value, so a bad setting fails the boot.
 */
export function readBoolEnv(
  source: EnvSource,
  key: string,
  defaultValue: boolean,
): boolean {
  const raw =
    source instanceof ConfigService
      ? source.get<string | boolean>(key)
      : source[key];
  const text =
    raw === undefined || raw === null ? '' : String(raw).trim().toLowerCase();
  if (text === '') return defaultValue;
  if (TRUE_VALUES.has(text)) return true;
  if (FALSE_VALUES.has(text)) return false;
  throw new Error(`${key} is "${String(raw)}"; it must be true or false`);
}
