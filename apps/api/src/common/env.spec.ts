import { ConfigService } from '@nestjs/config';
import { readBoolEnv, readIntEnv } from './env';

describe('readIntEnv', () => {
  it('should return the default when the key is unset or blank', () => {
    expect(readIntEnv({}, 'K', { default: 7 })).toBe(7);
    expect(readIntEnv({ K: '' }, 'K', { default: 7 })).toBe(7);
    expect(readIntEnv({ K: '  ' }, 'K', { default: 7 })).toBe(7);
  });

  it('should parse a base-10 integer when the value is 0 or has surrounding space', () => {
    expect(readIntEnv({ K: '25' }, 'K', { default: 7 })).toBe(25);
    expect(readIntEnv({ K: ' 3 ' }, 'K', { default: 7 })).toBe(3);
    expect(readIntEnv({ K: '0' }, 'K', { default: 7 })).toBe(0);
  });

  it('should read the value when the source is a ConfigService', () => {
    const config = new ConfigService({ K: '12' });
    expect(readIntEnv(config, 'K', { default: 7 })).toBe(12);
    expect(readIntEnv(config, 'MISSING', { default: 7 })).toBe(7);
  });

  it.each(['abc', '1.5', '-1', '1e3', '0x10', '10px', 'NaN'])(
    'should throw naming the key and the value when the value is %s',
    (value) => {
      expect(() => readIntEnv({ K: value }, 'K', { default: 7 })).toThrow(
        new RegExp(`K.*${value}`),
      );
    },
  );

  it('should throw when the value is outside min and max', () => {
    expect(() => readIntEnv({ K: '0' }, 'K', { default: 7, min: 1 })).toThrow(
      /K.*"0".*>= 1/,
    );
    expect(() => readIntEnv({ K: '11' }, 'K', { default: 7, max: 10 })).toThrow(
      /K.*"11".*<= 10/,
    );
    expect(readIntEnv({ K: '10' }, 'K', { default: 7, max: 10 })).toBe(10);
  });

  it('should allow negatives only when min permits', () => {
    expect(readIntEnv({ K: '-1' }, 'K', { default: 0, min: -5 })).toBe(-1);
  });
});

describe('readBoolEnv', () => {
  it('should return the default when the key is unset or blank', () => {
    expect(readBoolEnv({}, 'K', false)).toBe(false);
    expect(readBoolEnv({ K: ' ' }, 'K', true)).toBe(true);
  });

  it.each([
    ['true', true],
    ['TRUE', true],
    ['1', true],
    [' false ', false],
    ['0', false],
  ])('should read %p as %p', (value, expected) => {
    expect(readBoolEnv({ K: value }, 'K', !expected)).toBe(expected);
  });

  it('should read the value when the source is a ConfigService', () => {
    expect(readBoolEnv(new ConfigService({ K: 'true' }), 'K', false)).toBe(
      true,
    );
  });

  it.each(['yes', 'on', '2'])(
    'should throw naming the key and the value when the value is %s',
    (value) => {
      expect(() => readBoolEnv({ K: value }, 'K', false)).toThrow(
        new RegExp(`K.*${value}`),
      );
    },
  );
});
