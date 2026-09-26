import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Types } from 'mongoose';

type TrackedRequest = {
  user?: { _id?: Types.ObjectId | string };
  ip?: string;
};

/**
 * Rate-limits per authenticated user rather than per IP. Browser traffic
 * reaches the API through the web app's rewrite proxy, so `req.ip` is shared
 * by every user; the user id is the only meaningful bucket.
 *
 * Global guards run before controller guards, so this cannot be an
 * `APP_GUARD`: list it after `ClerkAuthGuard`, which attaches `req.user`.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: TrackedRequest): Promise<string> {
    const userId = req.user?._id?.toString();
    return Promise.resolve(userId ? `user:${userId}` : `ip:${req.ip}`);
  }
}
