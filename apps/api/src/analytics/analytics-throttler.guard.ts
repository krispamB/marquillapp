import { Injectable } from '@nestjs/common';
import { minutes } from '@nestjs/throttler';
import type { ThrottlerRequest } from '@nestjs/throttler';
import { UserThrottlerGuard } from '../common/guards/user-throttler.guard';

/** `?refresh=true` reads: each one spends LinkedIn quota. */
export const ANALYTICS_REFRESH_LIMIT = 10;
export const ANALYTICS_REFRESH_TTL_MS = minutes(1);

/**
 * `UserThrottlerGuard` with a tighter, separate bucket for `refresh=true`,
 * which bypasses the cache and calls LinkedIn. Plain reads keep the default
 * limit. Use it in place of `UserThrottlerGuard`, after `ClerkAuthGuard`.
 */
@Injectable()
export class AnalyticsThrottlerGuard extends UserThrottlerGuard {
  protected handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const { req } = this.getRequestResponse(requestProps.context);
    const query = (req.query ?? {}) as Record<string, unknown>;
    if (query.refresh !== 'true') return super.handleRequest(requestProps);

    const { generateKey } = requestProps;
    return super.handleRequest({
      ...requestProps,
      limit: Math.min(requestProps.limit, ANALYTICS_REFRESH_LIMIT),
      ttl: ANALYTICS_REFRESH_TTL_MS,
      generateKey: (context, tracker, name) =>
        `${generateKey(context, tracker, name)}:refresh`,
    });
  }
}
