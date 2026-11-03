import { ConfigService } from '@nestjs/config';
import { mongoOptionsFrom } from './mongo-options';

const configOf = (env: Record<string, string>) => new ConfigService(env);

describe('mongoOptionsFrom', () => {
  it('should default to the previous pool sizes when no pool config is set', () => {
    expect(mongoOptionsFrom(configOf({ MONGO_URI: 'mongodb://h/db' }))).toEqual(
      {
        uri: 'mongodb://h/db',
        maxPoolSize: 10,
        minPoolSize: 2,
        serverSelectionTimeoutMS: 5000,
      },
    );
  });

  it('should read the pool sizes when they are set in config', () => {
    const options = mongoOptionsFrom(
      configOf({ MONGO_MAX_POOL_SIZE: '40', MONGO_MIN_POOL_SIZE: '5' }),
    );
    expect(options).toMatchObject({ maxPoolSize: 40, minPoolSize: 5 });
  });

  it.each([
    ['non-integer', { MONGO_MAX_POOL_SIZE: 'lots' }, /MONGO_MAX_POOL_SIZE/],
    ['negative', { MONGO_MIN_POOL_SIZE: '-1' }, /MONGO_MIN_POOL_SIZE/],
    ['zero max', { MONGO_MAX_POOL_SIZE: '0' }, /MONGO_MAX_POOL_SIZE/],
    [
      'min above max',
      { MONGO_MAX_POOL_SIZE: '4', MONGO_MIN_POOL_SIZE: '5' },
      /MONGO_MIN_POOL_SIZE.*MONGO_MAX_POOL_SIZE/,
    ],
    [
      'a min above the default max',
      { MONGO_MIN_POOL_SIZE: '11' },
      /MONGO_MIN_POOL_SIZE.*MONGO_MAX_POOL_SIZE/,
    ],
  ])('should reject %s', (_name, env, message) => {
    expect(() => mongoOptionsFrom(configOf(env))).toThrow(message);
  });
});
