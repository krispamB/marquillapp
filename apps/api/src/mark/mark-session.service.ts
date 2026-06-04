import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { MarkMessage, MarkSession } from './types/mark-session.types';

const SESSION_TTL_SECONDS = 1800; // 30 minutes, sliding — reset on every write
const KEY_PREFIX = 'mark:session';

@Injectable()
export class MarkSessionService {
  constructor(private readonly redisService: RedisService) {}

  private key(userId: string): string {
    return `${KEY_PREFIX}:${userId}`;
  }

  private deserialize(raw: string): MarkSession {
    try {
      return JSON.parse(raw) as MarkSession;
    } catch {
      // Corrupted JSON is a storage-layer bug, not a client error
      throw new InternalServerErrorException('Mark session data is corrupted');
    }
  }

  private async save(session: MarkSession): Promise<void> {
    await this.redisService
      .getClient()
      .set(
        this.key(session.userId),
        JSON.stringify(session),
        'EX',
        SESSION_TTL_SECONDS,
      );
  }

  async getSession(userId: string): Promise<MarkSession> {
    const raw = await this.redisService.getClient().get(this.key(userId));
    if (raw === null) {
      throw new NotFoundException('No active Mark session found');
    }
    return this.deserialize(raw);
  }

  // Overwrites any existing session — one active session per user is enforced here,
  // not via a conflict guard, because stale sessions should be silently replaced.
  async createSession(userId: string): Promise<MarkSession> {
    const now = new Date().toISOString();
    const session: MarkSession = {
      userId,
      status: 'active',
      messages: [],
      intent: null,
      artifactId: null,
      refinementCount: 0,
      pendingClarification: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.save(session);
    return session;
  }

  async updateSession(
    userId: string,
    partial: Partial<Omit<MarkSession, 'userId' | 'createdAt'>>,
  ): Promise<MarkSession> {
    const session = await this.getSession(userId);
    const updated: MarkSession = {
      ...session,
      ...partial,
      // Guard immutable fields against accidental overwrites via the Partial spread
      userId: session.userId,
      createdAt: session.createdAt,
      updatedAt: new Date().toISOString(),
    };
    await this.save(updated);
    return updated;
  }

  // Accepts a message without a timestamp — the service always stamps it server-side
  // so the history is monotonically ordered regardless of client clock skew.
  async appendMessage(
    userId: string,
    message: Omit<MarkMessage, 'timestamp'>,
  ): Promise<MarkSession> {
    const session = await this.getSession(userId);
    const stamped: MarkMessage = {
      ...message,
      timestamp: new Date().toISOString(),
    };
    const updated: MarkSession = {
      ...session,
      messages: [...session.messages, stamped],
      updatedAt: new Date().toISOString(),
    };
    await this.save(updated);
    return updated;
  }

  async incrementRefinement(userId: string): Promise<MarkSession> {
    const session = await this.getSession(userId);
    const updated: MarkSession = {
      ...session,
      refinementCount: session.refinementCount + 1,
      updatedAt: new Date().toISOString(),
    };
    await this.save(updated);
    return updated;
  }

  async endSession(userId: string): Promise<MarkSession> {
    return this.updateSession(userId, { status: 'completed' });
  }
}
