import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

export const ANALYTICS_CACHE_TIMEOUT_MS = 500;

/**
 * JSON values in Redis for analytics. It fails open: a Redis error or a slow
 * answer logs a warning and reads as a miss, so Redis can never fail or stall
 * an analytics request.
 */
@Injectable()
export class AnalyticsCacheService {
  private readonly logger = new Logger(AnalyticsCacheService.name);
  timeoutMs = ANALYTICS_CACHE_TIMEOUT_MS;

  constructor(private readonly redisService: RedisService) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.withTimeout(
        this.redisService.getClient().get(key),
      );
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (error) {
      this.logger.warn(
        `Analytics cache read failed for ${key}: ${this.describe(error)}`,
      );
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    try {
      await this.withTimeout(
        this.redisService
          .getClient()
          .set(key, JSON.stringify(value), 'EX', ttlSeconds),
      );
    } catch (error) {
      this.logger.warn(
        `Analytics cache write failed for ${key}: ${this.describe(error)}`,
      );
    }
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timed out after ${this.timeoutMs} ms`)),
        this.timeoutMs,
      );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
