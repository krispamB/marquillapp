import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  INestApplication,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'http';
import { ThrottlerModule, minutes } from '@nestjs/throttler';
import { Types } from 'mongoose';
import request from 'supertest';
import { UserThrottlerGuard } from './user-throttler.guard';

type TrackerAccess = {
  getTracker(req: Record<string, unknown>): Promise<string>;
};

const makeGuard = () =>
  Object.create(UserThrottlerGuard.prototype) as unknown as TrackerAccess;

describe('UserThrottlerGuard', () => {
  describe('getTracker', () => {
    it('should bucket by user id when the request is authenticated', async () => {
      const userId = new Types.ObjectId();

      await expect(
        makeGuard().getTracker({ user: { _id: userId }, ip: '10.0.0.1' }),
      ).resolves.toBe(`user:${userId.toString()}`);
    });

    it('should give two users behind the same proxy ip separate buckets', async () => {
      const guard = makeGuard();
      const ip = '76.76.21.21';

      const first = await guard.getTracker({
        user: { _id: new Types.ObjectId() },
        ip,
      });
      const second = await guard.getTracker({
        user: { _id: new Types.ObjectId() },
        ip,
      });

      expect(first).not.toBe(second);
    });

    it('should fall back to the ip when no user is attached', async () => {
      await expect(makeGuard().getTracker({ ip: '10.0.0.1' })).resolves.toBe(
        'ip:10.0.0.1',
      );
    });
  });

  describe('wiring', () => {
    /** Stands in for ClerkAuthGuard: attaches the user named by a header. */
    @Injectable()
    class HeaderUserGuard implements CanActivate {
      canActivate(context: ExecutionContext): boolean {
        const req = context
          .switchToHttp()
          .getRequest<{ headers: Record<string, string>; user?: unknown }>();
        req.user = { _id: req.headers['x-user'] };
        return true;
      }
    }

    @Controller('probe')
    @UseGuards(HeaderUserGuard, UserThrottlerGuard)
    class ProbeController {
      @Get()
      probe() {
        return { ok: true };
      }
    }

    let app: INestApplication;

    beforeEach(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ThrottlerModule.forRoot({
            throttlers: [{ ttl: minutes(1), limit: 2 }],
          }),
        ],
        controllers: [ProbeController],
      }).compile();
      app = moduleRef.createNestApplication();
      await app.init();
    });

    afterEach(async () => {
      await app.close();
    });

    it('should return 429 when one user exceeds the limit while another user is unaffected', async () => {
      const server = app.getHttpServer() as Server;

      await request(server).get('/probe').set('x-user', 'a').expect(200);
      await request(server).get('/probe').set('x-user', 'a').expect(200);
      const limited = await request(server)
        .get('/probe')
        .set('x-user', 'a')
        .expect(429);
      expect(Number(limited.get('Retry-After'))).toBeGreaterThan(0);

      await request(server).get('/probe').set('x-user', 'b').expect(200);
    });
  });
});
