import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { MarkSessionService } from './mark-session.service';
import { MarkSession } from './types/mark-session.types';

const makeService = () => {
  const redisClient = {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
  };
  const redisService = { getClient: jest.fn().mockReturnValue(redisClient) };
  const service = new MarkSessionService(redisService as any);
  const fixtures = {
    userId: 'user-abc',
    session: {
      userId: 'user-abc',
      status: 'active' as const,
      messages: [],
      intent: null,
      artifactId: null,
      refinementCount: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } satisfies MarkSession,
  };
  return { service, mocks: { redisClient, redisService }, fixtures };
};

describe('MarkSessionService', () => {
  let service: MarkSessionService;
  let mocks: ReturnType<typeof makeService>['mocks'];
  let fixtures: ReturnType<typeof makeService>['fixtures'];

  const now = new Date('2026-01-01T00:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(now);
    ({ service, mocks, fixtures } = makeService());
  });

  afterEach(() => jest.useRealTimers());

  describe('getSession', () => {
    it('should return the deserialized session when found', async () => {
      mocks.redisClient.get.mockResolvedValue(JSON.stringify(fixtures.session));
      await expect(service.getSession(fixtures.userId)).resolves.toEqual(
        fixtures.session,
      );
      expect(mocks.redisClient.get).toHaveBeenCalledWith(
        `mark:session:${fixtures.userId}`,
      );
    });

    it('should throw NotFoundException when no session exists', async () => {
      mocks.redisClient.get.mockResolvedValue(null);
      await expect(service.getSession(fixtures.userId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('should throw InternalServerErrorException when stored value is not valid JSON', async () => {
      mocks.redisClient.get.mockResolvedValue('{corrupted::json}');
      await expect(service.getSession(fixtures.userId)).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });
  });

  describe('createSession', () => {
    it('should persist a new session with correct defaults and return it', async () => {
      const result = await service.createSession(fixtures.userId);
      expect(result).toEqual<MarkSession>({
        userId: fixtures.userId,
        status: 'active',
        messages: [],
        intent: null,
        artifactId: null,
        refinementCount: 0,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
      expect(mocks.redisClient.set).toHaveBeenCalledWith(
        `mark:session:${fixtures.userId}`,
        JSON.stringify(result),
        'EX',
        1800,
      );
    });

    it('should silently overwrite an existing session without reading it first', async () => {
      await service.createSession(fixtures.userId);
      expect(mocks.redisClient.get).not.toHaveBeenCalled();
      expect(mocks.redisClient.set).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateSession', () => {
    it('should merge partial fields, preserve immutable fields, and reset TTL', async () => {
      mocks.redisClient.get.mockResolvedValue(JSON.stringify(fixtures.session));
      const result = await service.updateSession(fixtures.userId, {
        artifactId: 'art-001',
      });
      expect(result.artifactId).toBe('art-001');
      expect(result.userId).toBe(fixtures.userId);
      expect(result.createdAt).toBe(fixtures.session.createdAt);
      expect(mocks.redisClient.set).toHaveBeenCalledWith(
        `mark:session:${fixtures.userId}`,
        expect.any(String),
        'EX',
        1800,
      );
    });

    it('should not allow overwriting userId even when included in partial', async () => {
      mocks.redisClient.get.mockResolvedValue(JSON.stringify(fixtures.session));
      const result = await service.updateSession(fixtures.userId, {
        userId: 'other-user' as any,
      });
      expect(result.userId).toBe(fixtures.userId);
    });

    it('should not allow overwriting createdAt even when included in partial', async () => {
      mocks.redisClient.get.mockResolvedValue(JSON.stringify(fixtures.session));
      const result = await service.updateSession(fixtures.userId, {
        createdAt: '1970-01-01T00:00:00.000Z' as any,
      });
      expect(result.createdAt).toBe(fixtures.session.createdAt);
    });

    it('should throw NotFoundException when session does not exist', async () => {
      mocks.redisClient.get.mockResolvedValue(null);
      await expect(
        service.updateSession(fixtures.userId, {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('appendMessage', () => {
    it('should append the message with a server-assigned timestamp and reset TTL', async () => {
      mocks.redisClient.get.mockResolvedValue(JSON.stringify(fixtures.session));
      const result = await service.appendMessage(fixtures.userId, {
        role: 'user',
        content: 'Write me a post about AI leadership',
      });
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toEqual({
        role: 'user',
        content: 'Write me a post about AI leadership',
        timestamp: now.toISOString(),
      });
    });

    it('should preserve existing messages when appending', async () => {
      const sessionWithMessage: MarkSession = {
        ...fixtures.session,
        messages: [
          {
            role: 'user',
            content: 'First message',
            timestamp: now.toISOString(),
          },
        ],
      };
      mocks.redisClient.get.mockResolvedValue(
        JSON.stringify(sessionWithMessage),
      );
      const result = await service.appendMessage(fixtures.userId, {
        role: 'assistant',
        content: 'Here is your post',
      });
      expect(result.messages).toHaveLength(2);
    });

    it('should throw NotFoundException when session does not exist', async () => {
      mocks.redisClient.get.mockResolvedValue(null);
      await expect(
        service.appendMessage(fixtures.userId, {
          role: 'user',
          content: 'Hello',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('incrementRefinement', () => {
    it('should increment refinementCount by 1', async () => {
      mocks.redisClient.get.mockResolvedValue(JSON.stringify(fixtures.session));
      const result = await service.incrementRefinement(fixtures.userId);
      expect(result.refinementCount).toBe(1);
    });

    it('should increment from an existing non-zero count', async () => {
      const sessionWithCount: MarkSession = {
        ...fixtures.session,
        refinementCount: 1,
      };
      mocks.redisClient.get.mockResolvedValue(JSON.stringify(sessionWithCount));
      const result = await service.incrementRefinement(fixtures.userId);
      expect(result.refinementCount).toBe(2);
    });

    it('should throw NotFoundException when session does not exist', async () => {
      mocks.redisClient.get.mockResolvedValue(null);
      await expect(
        service.incrementRefinement(fixtures.userId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('endSession', () => {
    it('should set status to completed', async () => {
      mocks.redisClient.get.mockResolvedValue(JSON.stringify(fixtures.session));
      const result = await service.endSession(fixtures.userId);
      expect(result.status).toBe('completed');
    });

    it('should still reset the TTL so the completed session remains readable briefly', async () => {
      mocks.redisClient.get.mockResolvedValue(JSON.stringify(fixtures.session));
      await service.endSession(fixtures.userId);
      expect(mocks.redisClient.set).toHaveBeenCalledWith(
        `mark:session:${fixtures.userId}`,
        expect.any(String),
        'EX',
        1800,
      );
    });

    it('should throw NotFoundException when session does not exist', async () => {
      mocks.redisClient.get.mockResolvedValue(null);
      await expect(service.endSession(fixtures.userId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
