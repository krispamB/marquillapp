import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { AuthService } from './auth.service';
import { ConnectedAccount } from '../database/schemas/connected-account.schema';
import { EncryptionService } from '../encryption/encryption.service';
import { FeatureGatingService } from '../feature-gating';
import { LinkedinAvatarRefreshQueue } from '../workflow/linkedin-avatar-refresh.queue';
import { ScheduleQueue } from '../workflow/schedule.queue';
import { RedisService } from '../redis/redis.service';

jest.mock(
  'src/common/HelperFn',
  () => ({
    apiFetch: jest.fn(),
    ApiError: class ApiError extends Error {},
  }),
  { virtual: true },
);
jest.mock(
  '../feature-gating/feature-gating.service',
  () => ({ FeatureGatingService: class FeatureGatingService {} }),
  { virtual: true },
);

describe('AuthService DI', () => {
  it('resolves AuthService with workflow-owned LinkedinAvatarRefreshQueue', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        LinkedinAvatarRefreshQueue,
        {
          provide: getModelToken(ConnectedAccount.name),
          useValue: {},
        },
        {
          provide: getModelToken('Post'),
          useValue: {},
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test-value'),
            getOrThrow: jest.fn().mockReturnValue('test-value'),
          },
        },
        {
          provide: EncryptionService,
          useValue: {},
        },
        {
          provide: FeatureGatingService,
          useValue: {},
        },
        {
          provide: ScheduleQueue,
          useValue: {
            queue: {
              getJob: jest.fn(),
            },
          },
        },
        {
          provide: RedisService,
          useValue: {},
        },
      ],
    }).compile();

    const service = moduleRef.get(AuthService);
    expect(service).toBeDefined();
  });
});
