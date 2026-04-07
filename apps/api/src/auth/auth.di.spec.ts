import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { AuthService } from './auth.service';
import { User } from '../database/schemas/user.schema';
import { ConnectedAccount } from '../database/schemas/connected-account.schema';
import { Tier } from '../database/schemas/tier.schema';
import { JwtService } from '@nestjs/jwt';
import { EncryptionService } from '../encryption/encryption.service';
import { FeatureGatingService } from '../feature-gating';
import { LinkedinAvatarRefreshQueue } from '../workflow/linkedin-avatar-refresh.queue';
import { ScheduleQueue } from '../workflow/schedule.queue';
import { EmailQueue } from '../workflow/email.queue';

jest.mock(
  'src/common/HelperFn',
  () => ({
    apiFetch: jest.fn(),
    ApiError: class ApiError extends Error {},
  }),
  { virtual: true },
);
jest.mock(
  '../feature-gating',
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
          provide: getModelToken(User.name),
          useValue: {},
        },
        {
          provide: getModelToken(ConnectedAccount.name),
          useValue: {},
        },
        {
          provide: getModelToken('PostDraft'),
          useValue: {},
        },
        {
          provide: getModelToken(Tier.name),
          useValue: {},
        },
        {
          provide: JwtService,
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
          provide: EmailQueue,
          useValue: {},
        },
      ],
    }).compile();

    const service = moduleRef.get(AuthService);
    expect(service).toBeDefined();
  });
});
