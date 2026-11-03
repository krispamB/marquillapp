import { ConfigService } from '@nestjs/config';
import { MongooseModuleFactoryOptions } from '@nestjs/mongoose';
import { readIntEnv } from '../common/env';

/**
 * Mongo connection options. Each process holds its own pool, so size the
 * worker's `MONGO_MAX_POOL_SIZE` to at least its total worker concurrency + 10.
 */
export function mongoOptionsFrom(
  config: ConfigService,
): MongooseModuleFactoryOptions {
  const maxPoolSize = readIntEnv(config, 'MONGO_MAX_POOL_SIZE', {
    default: 10,
    min: 1,
  });
  const minPoolSize = readIntEnv(config, 'MONGO_MIN_POOL_SIZE', {
    default: 2,
  });
  if (minPoolSize > maxPoolSize) {
    throw new Error(
      `MONGO_MIN_POOL_SIZE (${minPoolSize}) must not exceed MONGO_MAX_POOL_SIZE (${maxPoolSize})`,
    );
  }

  return {
    uri: config.get<string>('MONGO_URI'),
    maxPoolSize,
    minPoolSize,
    serverSelectionTimeoutMS: 5000,
  };
}
