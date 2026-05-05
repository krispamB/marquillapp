import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  AccountProvider,
  LinkedinAccountType,
} from '../database/schemas/connected-account.schema';
import { ApiError, apiFetch } from 'src/common/HelperFn';
import { EmailQueue } from '../workflow/email.queue';

jest.mock(
  'src/common/HelperFn',
  () => ({
    apiFetch: jest.fn(),
    ApiError: class ApiError extends Error {
      constructor(
        public statusCode: number,
        public statusText: string,
        public data: any,
      ) {
        super(`HTTP error! status: ${statusCode} ${statusText}`);
      }
    },
  }),
  {
    virtual: true,
  },
);
jest.mock(
  '../feature-gating/feature-gating.service',
  () => ({ FeatureGatingService: class FeatureGatingService {} }),
  { virtual: true },
);

import { AuthService } from './auth.service';

describe('AuthService.validateGoogleUser', () => {
  const makeService = () => {
    const existingByGoogleId = {
      _id: new Types.ObjectId(),
      email: 'existing-google@example.com',
    };
    const existingByEmail = {
      _id: new Types.ObjectId(),
      email: 'existing-email@example.com',
      googleId: null,
      avatar: 'old-avatar',
      save: jest.fn().mockResolvedValue(undefined),
    };
    const createdUser = {
      _id: new Types.ObjectId(),
      email: 'new-user@example.com',
      name: 'New User',
      googleId: 'google-new',
    };

    const userModel = {
      findOne: jest.fn(),
      create: jest.fn(),
    };
    const tierModel = {
      findOne: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    };
    const emailQueue = {
      addWelcomeEmailJob: jest.fn().mockResolvedValue(undefined),
    };

    const service = new AuthService(
      userModel as any,
      {} as any,
      {} as any,
      {} as any,
      tierModel as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      emailQueue as EmailQueue,
    );

    return {
      service,
      mocks: { userModel, tierModel, emailQueue },
      fixtures: { existingByGoogleId, existingByEmail, createdUser },
    };
  };

  it('enqueues welcome email once when a new user is created', async () => {
    const { service, mocks, fixtures } = makeService();
    mocks.userModel.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mocks.userModel.create.mockResolvedValue(fixtures.createdUser);

    const result = await service.validateGoogleUser({
      email: fixtures.createdUser.email,
      name: fixtures.createdUser.name,
      avatar: 'avatar-url',
      googleId: fixtures.createdUser.googleId,
    });

    expect(result).toEqual(fixtures.createdUser);
    expect(mocks.userModel.create).toHaveBeenCalledTimes(1);
    expect(mocks.emailQueue.addWelcomeEmailJob).toHaveBeenCalledTimes(1);
    expect(mocks.emailQueue.addWelcomeEmailJob).toHaveBeenCalledWith(
      fixtures.createdUser.email,
      fixtures.createdUser.name,
    );
  });

  it('does not enqueue welcome email for existing googleId user', async () => {
    const { service, mocks, fixtures } = makeService();
    mocks.userModel.findOne.mockResolvedValueOnce(fixtures.existingByGoogleId);

    await service.validateGoogleUser({
      email: fixtures.existingByGoogleId.email,
      name: 'Existing User',
      avatar: 'avatar-url',
      googleId: 'google-existing',
    });

    expect(mocks.userModel.create).not.toHaveBeenCalled();
    expect(mocks.emailQueue.addWelcomeEmailJob).not.toHaveBeenCalled();
  });

  it('does not enqueue welcome email when linking googleId to existing email user', async () => {
    const { service, mocks, fixtures } = makeService();
    mocks.userModel.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(fixtures.existingByEmail);

    await service.validateGoogleUser({
      email: fixtures.existingByEmail.email,
      name: 'Existing User',
      avatar: 'new-avatar-url',
      googleId: 'google-linked',
    });

    expect(fixtures.existingByEmail.save).toHaveBeenCalledTimes(1);
    expect(mocks.userModel.create).not.toHaveBeenCalled();
    expect(mocks.emailQueue.addWelcomeEmailJob).not.toHaveBeenCalled();
  });

  it('does not throw when welcome email enqueue fails for a new user', async () => {
    const { service, mocks, fixtures } = makeService();
    mocks.userModel.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mocks.userModel.create.mockResolvedValue(fixtures.createdUser);
    mocks.emailQueue.addWelcomeEmailJob.mockRejectedValueOnce(
      new Error('queue unavailable'),
    );

    await expect(
      service.validateGoogleUser({
        email: fixtures.createdUser.email,
        name: fixtures.createdUser.name,
        avatar: 'avatar-url',
        googleId: fixtures.createdUser.googleId,
      }),
    ).resolves.toEqual(fixtures.createdUser);

    expect(mocks.emailQueue.addWelcomeEmailJob).toHaveBeenCalledTimes(1);
  });
});

describe('AuthService.linkedinCallback', () => {
  const makeService = () => {
    const userModel = {};
    const jwtService = {};
    const connectedAccountModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({}),
    };
    const postDraftModel = {
      find: jest.fn(),
      updateMany: jest.fn(),
    };
    const tierModel = {};
    const configService = {};
    const encryptionService = {
      encrypt: jest.fn().mockResolvedValue('encrypted-token'),
    };
    const featureGatingService = {
      assertConnectedAccountCapacity: jest.fn().mockResolvedValue(undefined),
    };
    const linkedinAvatarRefreshQueue = {
      addAvatarRefreshJob: jest.fn().mockResolvedValue(undefined),
    };
    const scheduleQueue = {
      queue: {
        getJob: jest.fn(),
      },
    };
    const emailQueue = {
      addWelcomeEmailJob: jest.fn(),
    };

    const service = new AuthService(
      userModel as any,
      jwtService as any,
      connectedAccountModel as any,
      postDraftModel as any,
      tierModel as any,
      configService as any,
      encryptionService as any,
      featureGatingService as any,
      linkedinAvatarRefreshQueue as any,
      scheduleQueue as any,
      emailQueue as any,
    );

    return {
      service,
      mocks: {
        connectedAccountModel,
        postDraftModel,
        encryptionService,
        featureGatingService,
        linkedinAvatarRefreshQueue,
        scheduleQueue,
      },
    };
  };

  it('upserts a new LinkedIn account when no existing connection is found', async () => {
    const { service, mocks } = makeService();
    const userId = new Types.ObjectId().toString();
    jest
      .spyOn(service as any, 'getLinkedinAccessToken')
      .mockResolvedValue({ access_token: 'access', expires_in: 3600 });
    jest.spyOn(service as any, 'getLinkedinUser').mockResolvedValue({
      memberId: 'linkedin-sub',
      displayName: 'Bob Smith',
      avatarUrl: 'https://example.com/avatar.jpg',
      avatarUrlExpiresAt: new Date(1711111111 * 1000),
      profileMetadata: { memberId: 'linkedin-sub', sub: 'linkedin-sub' },
    });
    mocks.connectedAccountModel.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mocks.connectedAccountModel.findOneAndUpdate.mockResolvedValue({});

    await service.linkedinCallback('code', userId);

    expect(mocks.connectedAccountModel.findOneAndUpdate).toHaveBeenCalled();
    const updatePayload =
      mocks.connectedAccountModel.findOneAndUpdate.mock.calls[0][1];
    expect(updatePayload.avatarUrlExpiresAt).toEqual(
      new Date(1711111111 * 1000),
    );
    expect(updatePayload.profileMetadata.avatarUrl).toBeUndefined();
  });

  it('updates the existing LinkedIn account when the same memberId reconnects', async () => {
    const { service, mocks } = makeService();
    const userId = new Types.ObjectId().toString();
    jest
      .spyOn(service as any, 'getLinkedinAccessToken')
      .mockResolvedValue({ access_token: 'access', expires_in: 3600 });
    jest.spyOn(service as any, 'getLinkedinUser').mockResolvedValue({
      memberId: 'linkedin-sub',
      displayName: 'Bob Smith',
      avatarUrl: 'https://example.com/avatar.jpg',
      avatarUrlExpiresAt: new Date(1711111111 * 1000),
      profileMetadata: { memberId: 'linkedin-sub', sub: 'linkedin-sub' },
    });
    mocks.connectedAccountModel.findOne
      .mockResolvedValueOnce({
        user: userId,
        profileMetadata: { sub: 'linkedin-sub' },
      })
      .mockResolvedValueOnce({
        user: userId,
        profileMetadata: { sub: 'linkedin-sub' },
      });
    mocks.connectedAccountModel.findOneAndUpdate.mockResolvedValue({});

    await service.linkedinCallback('code', userId);

    expect(mocks.connectedAccountModel.findOne).toHaveBeenCalledWith({
      user: new Types.ObjectId(userId),
      provider: AccountProvider.LINKEDIN,
      $or: [
        { accountType: LinkedinAccountType.PERSON },
        { accountType: { $exists: false } },
      ],
    });
  });

  it('throws conflict when reconnecting with a different LinkedIn identity', async () => {
    const { service, mocks } = makeService();
    const userId = new Types.ObjectId().toString();
    jest
      .spyOn(service as any, 'getLinkedinAccessToken')
      .mockResolvedValue({ access_token: 'access', expires_in: 3600 });
    jest.spyOn(service as any, 'getLinkedinUser').mockResolvedValue({
      memberId: 'new-sub',
      displayName: 'Bob Smith',
      avatarUrl: 'https://example.com/avatar.jpg',
      avatarUrlExpiresAt: new Date(1711111111 * 1000),
      profileMetadata: { memberId: 'new-sub', sub: 'new-sub' },
    });
    mocks.connectedAccountModel.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        user: userId,
        isActive: true,
        profileMetadata: { sub: 'existing-sub' },
      });

    try {
      await service.linkedinCallback('code', userId);
      throw new Error('Expected linkedinCallback to throw');
    } catch (error: any) {
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.response).toMatchObject({
        code: 'LINKEDIN_ACCOUNT_MISMATCH',
      });
    }
    expect(
      mocks.featureGatingService.assertConnectedAccountCapacity,
    ).not.toHaveBeenCalled();
    expect(mocks.connectedAccountModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('accepts legacy connected accounts that only have profileMetadata.sub', async () => {
    const { service, mocks } = makeService();
    const userId = new Types.ObjectId().toString();
    jest
      .spyOn(service as any, 'getLinkedinAccessToken')
      .mockResolvedValue({ access_token: 'access', expires_in: 3600 });
    jest.spyOn(service as any, 'getLinkedinUser').mockResolvedValue({
      memberId: 'legacy-sub',
      displayName: 'Bob Smith',
      avatarUrl: 'https://example.com/avatar.jpg',
      avatarUrlExpiresAt: new Date(1711111111 * 1000),
      profileMetadata: { memberId: 'legacy-sub', sub: 'legacy-sub' },
    });
    mocks.connectedAccountModel.findOne
      .mockResolvedValueOnce({
        user: userId,
        profileMetadata: { sub: 'legacy-sub' },
      })
      .mockResolvedValueOnce({
        user: userId,
        profileMetadata: { sub: 'legacy-sub' },
      });
    mocks.connectedAccountModel.findOneAndUpdate.mockResolvedValue({});

    const result = await service.linkedinCallback('code', userId);

    expect(result).toBe(true);
    expect(mocks.connectedAccountModel.findOneAndUpdate).toHaveBeenCalled();
  });

  it('throws conflict when LinkedIn account is already owned by another user', async () => {
    const { service, mocks } = makeService();
    const userId = new Types.ObjectId().toString();
    const otherUserId = new Types.ObjectId().toString();
    jest
      .spyOn(service as any, 'getLinkedinAccessToken')
      .mockResolvedValue({ access_token: 'access', expires_in: 3600 });
    jest.spyOn(service as any, 'getLinkedinUser').mockResolvedValue({
      memberId: 'linkedin-sub',
      displayName: 'Bob Smith',
      avatarUrl: 'https://example.com/avatar.jpg',
      avatarUrlExpiresAt: new Date(1711111111 * 1000),
      profileMetadata: { memberId: 'linkedin-sub', sub: 'linkedin-sub' },
    });
    mocks.connectedAccountModel.findOne.mockResolvedValueOnce({
      user: otherUserId,
      externalId: 'linkedin-sub',
      profileMetadata: { sub: 'linkedin-sub' },
    });

    await expect(service.linkedinCallback('code', userId)).rejects.toMatchObject(
      {
        response: {
          code: 'LINKEDIN_ACCOUNT_ALREADY_CONNECTED',
        },
      },
    );
    expect(
      mocks.featureGatingService.assertConnectedAccountCapacity,
    ).not.toHaveBeenCalled();
    expect(mocks.connectedAccountModel.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('AuthService.disconnectConnectedAccount', () => {
  const makeService = () => {
    const connectedAccountModel = {
      findById: jest.fn(),
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue([]),
      }),
      countDocuments: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({}),
    };
    const postDraftModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue([]),
      }),
      updateMany: jest.fn().mockResolvedValue({}),
    };
    const scheduleQueue = {
      queue: {
        getJob: jest.fn().mockResolvedValue(null),
      },
    };
    const service = new AuthService(
      {} as any,
      {} as any,
      connectedAccountModel as any,
      postDraftModel as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      scheduleQueue as any,
      {} as any,
    );

    return { service, connectedAccountModel, postDraftModel, scheduleQueue };
  };

  it('deactivates personal account and org accounts, then cancels scheduled posts', async () => {
    const { service, connectedAccountModel, postDraftModel, scheduleQueue } =
      makeService();
    const userId = new Types.ObjectId().toString();
    const accountId = new Types.ObjectId().toString();
    const orgId = new Types.ObjectId();
    const remove = jest.fn().mockResolvedValue(undefined);

    connectedAccountModel.findById.mockResolvedValue({
      _id: accountId,
      user: userId,
      provider: AccountProvider.LINKEDIN,
      accountType: LinkedinAccountType.PERSON,
    });
    connectedAccountModel.find.mockReturnValueOnce({
      select: jest.fn().mockResolvedValue([{ _id: accountId }, { _id: orgId }]),
    });
    connectedAccountModel.countDocuments.mockResolvedValue(2);
    postDraftModel.find.mockReturnValueOnce({
      select: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId() }]),
    });
    scheduleQueue.queue.getJob.mockResolvedValueOnce({ remove });

    const result = await service.disconnectConnectedAccount(userId, accountId);

    expect(connectedAccountModel.updateMany).toHaveBeenCalled();
    expect(postDraftModel.updateMany).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'DRAFT',
          scheduledAt: null,
        }),
      }),
    );
    expect(remove).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      accountId,
      deactivatedCount: 2,
      scheduledPostsCanceled: 1,
    });
  });

  it('rejects disconnect when account is not owned by user', async () => {
    const { service, connectedAccountModel } = makeService();
    const userId = new Types.ObjectId().toString();
    const accountId = new Types.ObjectId().toString();

    connectedAccountModel.findById.mockResolvedValue({
      _id: accountId,
      user: new Types.ObjectId().toString(),
      provider: AccountProvider.LINKEDIN,
      accountType: LinkedinAccountType.PERSON,
    });

    await expect(
      service.disconnectConnectedAccount(userId, accountId),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('AuthService.getLinkedinUser', () => {
  const createService = () =>
    new AuthService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('parses /v2/me response without decorated profile picture', async () => {
    const service = createService();
    (apiFetch as jest.Mock).mockResolvedValue({
      data: {
        id: 'yrZCpj2Z12',
        localizedFirstName: 'Bob',
        localizedLastName: 'Smith',
        localizedHeadline: 'API Enthusiast at LinkedIn',
        vanityName: 'bsmith',
        profilePicture: {
          displayImage: 'urn:li:digitalmediaAsset:C4D00AAAAbBCDEFGhiJ',
        },
      },
    });

    const result = await (service as any).getLinkedinUser('token');

    expect(result.memberId).toBe('yrZCpj2Z12');
    expect(result.displayName).toBe('Bob Smith');
    expect(result.displayImageUrn).toBe(
      'urn:li:digitalmediaAsset:C4D00AAAAbBCDEFGhiJ',
    );
    expect(result.avatarUrl).toBeUndefined();
    expect(result.profileMetadata.sub).toBe('yrZCpj2Z12');
  });

  it('selects smallest decorated profile image url when available', async () => {
    const service = createService();
    (apiFetch as jest.Mock).mockResolvedValue({
      data: {
        id: 'yrZCpj2Z12',
        localizedFirstName: 'Bob',
        localizedLastName: 'Smith',
        profilePicture: {
          displayImage: 'urn:li:digitalmediaAsset:C4D00AAAAbBCDEFGhiJ',
          'displayImage~': {
            elements: [
              {
                data: {
                  'com.linkedin.digitalmedia.mediaartifact.StillImage': {
                    storageSize: { width: 100, height: 100 },
                  },
                },
                identifiers: [
                  {
                    identifier: 'https://cdn.example.com/small.jpg',
                    identifierExpiresInSeconds: 1719999999,
                  },
                ],
              },
              {
                data: {
                  'com.linkedin.digitalmedia.mediaartifact.StillImage': {
                    storageSize: { width: 400, height: 400 },
                  },
                },
                identifiers: [
                  {
                    identifier: 'https://cdn.example.com/large.jpg',
                    identifierExpiresInSeconds: 1729999999,
                  },
                ],
              },
            ],
          },
        },
      },
    });

    const result = await (service as any).getLinkedinUser('token');

    expect(result.avatarUrl).toBe('https://cdn.example.com/small.jpg');
    expect(result.avatarUrlExpiresAt).toEqual(new Date(1719999999 * 1000));
    expect(result.profileMetadata.avatarUrl).toBeUndefined();
    expect(result.profileMetadata.avatarUrlExpiresAt).toBeUndefined();
    expect(result.profileMetadata.profilePicture).toBeUndefined();
  });

  it('uses first identifier for chosen artifact when multiple identifiers exist', async () => {
    const service = createService();
    (apiFetch as jest.Mock).mockResolvedValue({
      data: {
        id: 'yrZCpj2Z12',
        localizedFirstName: 'Bob',
        localizedLastName: 'Smith',
        profilePicture: {
          displayImage: 'urn:li:digitalmediaAsset:C4D00AAAAbBCDEFGhiJ',
          'displayImage~': {
            elements: [
              {
                data: {
                  'com.linkedin.digitalmedia.mediaartifact.StillImage': {
                    storageSize: { width: 100, height: 100 },
                  },
                },
                identifiers: [
                  {
                    identifier: 'https://cdn.example.com/first.jpg',
                    identifierExpiresInSeconds: 1711111111,
                  },
                  {
                    identifier: 'https://cdn.example.com/second.jpg',
                    identifierExpiresInSeconds: 1722222222,
                  },
                ],
              },
              {
                data: {
                  'com.linkedin.digitalmedia.mediaartifact.StillImage': {
                    storageSize: { width: 400, height: 400 },
                  },
                },
                identifiers: [
                  {
                    identifier: 'https://cdn.example.com/large.jpg',
                    identifierExpiresInSeconds: 1729999999,
                  },
                ],
              },
            ],
          },
        },
      },
    });

    const result = await (service as any).getLinkedinUser('token');

    expect(result.avatarUrl).toBe('https://cdn.example.com/first.jpg');
    expect(result.avatarUrlExpiresAt).toEqual(new Date(1711111111 * 1000));
  });

  it('stores compact metadata fields only', async () => {
    const service = createService();
    (apiFetch as jest.Mock).mockResolvedValue({
      data: {
        id: 'yrZCpj2Z12',
        localizedFirstName: 'Bob',
        localizedLastName: 'Smith',
        localizedHeadline: 'API Enthusiast',
        vanityName: 'bobsmith',
        profilePicture: {
          displayImage: 'urn:li:digitalmediaAsset:C4D00AAAAbBCDEFGhiJ',
        },
      },
    });

    const result = await (service as any).getLinkedinUser('token');

    expect(result.profileMetadata).toEqual({
      sub: 'yrZCpj2Z12',
      memberId: 'yrZCpj2Z12',
      localizedFirstName: 'Bob',
      localizedLastName: 'Smith',
      localizedHeadline: 'API Enthusiast',
      displayImageUrn: 'urn:li:digitalmediaAsset:C4D00AAAAbBCDEFGhiJ',
      vanityName: 'bobsmith',
    });
    expect(result.profileMetadata.headline).toBeUndefined();
    expect(result.profileMetadata.profilePicture).toBeUndefined();
  });
});

describe('AuthService.getConnectedAccounts', () => {
  const makeService = (accounts: any[]) => {
    const connectedAccountModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue(accounts),
      }),
    };
    const linkedinAvatarRefreshQueue = {
      addAvatarRefreshJob: jest.fn().mockResolvedValue(undefined),
    };

    const service = new AuthService(
      {} as any,
      {} as any,
      connectedAccountModel as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      linkedinAvatarRefreshQueue as any,
      {} as any,
      {} as any,
    );

    return { service, connectedAccountModel, linkedinAvatarRefreshQueue };
  };

  it('queues refresh for expiring LinkedIn person avatars and nulls expired urls', async () => {
    const userId = new Types.ObjectId().toString();
    const expiringSoon = new Date(Date.now() + 60 * 60 * 1000);
    const alreadyExpired = new Date(Date.now() - 60 * 1000);

    const linkedInAccount = {
      _id: new Types.ObjectId(),
      provider: AccountProvider.LINKEDIN,
      accountType: LinkedinAccountType.PERSON,
      avatarUrl: 'https://cdn.example.com/avatar.jpg',
      avatarUrlExpiresAt: expiringSoon,
      profileMetadata: {
        displayImageUrn: 'urn:li:digitalmediaAsset:test',
      },
      toObject() {
        return { ...this };
      },
    };
    const expiredLinkedInAccount = {
      _id: new Types.ObjectId(),
      provider: AccountProvider.LINKEDIN,
      accountType: LinkedinAccountType.PERSON,
      avatarUrl: 'https://cdn.example.com/expired.jpg',
      avatarUrlExpiresAt: alreadyExpired,
      profileMetadata: {
        displayImageUrn: 'urn:li:digitalmediaAsset:test2',
      },
      toObject() {
        return { ...this };
      },
    };

    const { service, linkedinAvatarRefreshQueue, connectedAccountModel } =
      makeService([linkedInAccount, expiredLinkedInAccount]);

    const result = await service.getConnectedAccounts(userId);

    expect(connectedAccountModel.find).toHaveBeenCalledWith({
      user: new Types.ObjectId(userId),
      isActive: true,
    });
    expect(linkedinAvatarRefreshQueue.addAvatarRefreshJob).toHaveBeenCalledTimes(
      2,
    );
    expect(result[1].avatarUrl).toBeNull();
  });

  it('does not queue refresh for org accounts or accounts without displayImageUrn', async () => {
    const userId = new Types.ObjectId().toString();
    const organizationAccount = {
      _id: new Types.ObjectId(),
      provider: AccountProvider.LINKEDIN,
      accountType: LinkedinAccountType.ORGANIZATION,
      avatarUrl: 'https://cdn.example.com/org.jpg',
      avatarUrlExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      profileMetadata: {
        displayImageUrn: 'urn:li:digitalmediaAsset:test',
      },
      toObject() {
        return { ...this };
      },
    };
    const missingUrnAccount = {
      _id: new Types.ObjectId(),
      provider: AccountProvider.LINKEDIN,
      accountType: LinkedinAccountType.PERSON,
      avatarUrl: 'https://cdn.example.com/missing-urn.jpg',
      avatarUrlExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      profileMetadata: {},
      toObject() {
        return { ...this };
      },
    };

    const { service, linkedinAvatarRefreshQueue } = makeService([
      organizationAccount,
      missingUrnAccount,
    ]);

    await service.getConnectedAccounts(userId);

    expect(
      linkedinAvatarRefreshQueue.addAvatarRefreshJob,
    ).not.toHaveBeenCalled();
  });
});

describe('AuthService.refreshLinkedinAvatarForAccount', () => {
  const makeService = () => {
    const accountId = new Types.ObjectId().toString();
    const connectedAccount = {
      _id: accountId,
      provider: AccountProvider.LINKEDIN,
      accountType: LinkedinAccountType.PERSON,
      isActive: true,
      accessToken: 'encrypted',
      profileMetadata: {
        displayImageUrn: 'urn:li:digitalmediaAsset:123',
      },
    };

    const connectedAccountModel = {
      findById: jest.fn().mockResolvedValue(connectedAccount),
      findByIdAndUpdate: jest.fn().mockResolvedValue({}),
    };
    const encryptionService = {
      decrypt: jest.fn().mockResolvedValue('token'),
    };

    const service = new AuthService(
      {} as any,
      {} as any,
      connectedAccountModel as any,
      {} as any,
      {} as any,
      {} as any,
      encryptionService as any,
      {} as any,
      { addAvatarRefreshJob: jest.fn() } as any,
      {} as any,
      {} as any,
    );

    return { service, connectedAccountModel, encryptionService, accountId };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates avatar fields on successful refresh', async () => {
    const { service, connectedAccountModel, accountId } = makeService();
    jest.spyOn(service as any, 'getLinkedinUser').mockResolvedValue({
      avatarUrl: 'https://cdn.example.com/new.jpg',
      avatarUrlExpiresAt: new Date(1711111111 * 1000),
      displayImageUrn: 'urn:li:digitalmediaAsset:new',
    });

    await service.refreshLinkedinAvatarForAccount(accountId);

    expect(connectedAccountModel.findByIdAndUpdate).toHaveBeenCalledWith(
      accountId,
      expect.objectContaining({
        $set: expect.objectContaining({
          avatarUrl: 'https://cdn.example.com/new.jpg',
        }),
      }),
    );
  });

  it('clears avatar and marks auth failure when decrypt fails', async () => {
    const { service, connectedAccountModel, encryptionService, accountId } =
      makeService();
    encryptionService.decrypt.mockRejectedValue(new Error('decrypt failed'));
    connectedAccountModel.findById.mockResolvedValueOnce({
      _id: accountId,
      provider: AccountProvider.LINKEDIN,
      accountType: LinkedinAccountType.PERSON,
      isActive: true,
      accessToken: 'encrypted',
      profileMetadata: { displayImageUrn: 'urn:li:digitalmediaAsset:123' },
    });

    await service.refreshLinkedinAvatarForAccount(accountId);

    expect(connectedAccountModel.findByIdAndUpdate).toHaveBeenCalledWith(
      accountId,
      expect.objectContaining({
        $set: expect.objectContaining({
          avatarUrl: null,
          avatarUrlExpiresAt: null,
          profileMetadata: expect.objectContaining({
            avatarRefreshNeeded: true,
            avatarRefreshFailureReason: 'DECRYPT_FAILED',
          }),
        }),
      }),
    );
  });

  it('marks auth expired on 401 response without throwing', async () => {
    const { service, connectedAccountModel, accountId } = makeService();
    jest
      .spyOn(service as any, 'getLinkedinUser')
      .mockRejectedValue(new ApiError(401, 'Unauthorized', {}));
    connectedAccountModel.findById.mockResolvedValueOnce({
      _id: accountId,
      provider: AccountProvider.LINKEDIN,
      accountType: LinkedinAccountType.PERSON,
      isActive: true,
      accessToken: 'encrypted',
      profileMetadata: { displayImageUrn: 'urn:li:digitalmediaAsset:123' },
    });

    await expect(
      service.refreshLinkedinAvatarForAccount(accountId),
    ).resolves.toBeUndefined();

    expect(connectedAccountModel.findByIdAndUpdate).toHaveBeenCalledWith(
      accountId,
      expect.objectContaining({
        $set: expect.objectContaining({
          profileMetadata: expect.objectContaining({
            avatarRefreshFailureReason: 'AUTH_EXPIRED',
          }),
        }),
      }),
    );
  });

  it('throws transient failures for retries', async () => {
    const { service, accountId } = makeService();
    jest
      .spyOn(service as any, 'getLinkedinUser')
      .mockRejectedValue(new ApiError(503, 'Unavailable', {}));

    await expect(
      service.refreshLinkedinAvatarForAccount(accountId),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
