import { Types } from 'mongoose';
import {
  AccountProvider,
  LinkedinAccountType,
} from '../database/schemas/connected-account.schema';
import { apiFetch } from 'src/common/HelperFn';

jest.mock('src/common/HelperFn', () => ({ apiFetch: jest.fn() }), {
  virtual: true,
});
jest.mock(
  '../feature-gating/feature-gating.service',
  () => ({ FeatureGatingService: class FeatureGatingService {} }),
  { virtual: true },
);

import { AuthService } from './auth.service';

describe('AuthService.linkedinCallback', () => {
  const makeService = () => {
    const userModel = {};
    const jwtService = {};
    const connectedAccountModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({}),
    };
    const tierModel = {};
    const configService = {};
    const encryptionService = {
      encrypt: jest.fn().mockResolvedValue('encrypted-token'),
    };
    const featureGatingService = {
      assertConnectedAccountCapacity: jest.fn().mockResolvedValue(undefined),
    };

    const service = new AuthService(
      userModel as any,
      jwtService as any,
      connectedAccountModel as any,
      tierModel as any,
      configService as any,
      encryptionService as any,
      featureGatingService as any,
    );

    return {
      service,
      mocks: {
        connectedAccountModel,
        encryptionService,
        featureGatingService,
      },
    };
  };

  it('enforces connected account limit for new connections', async () => {
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
    mocks.connectedAccountModel.findOne.mockResolvedValue(null);
    mocks.connectedAccountModel.findOneAndUpdate.mockResolvedValue({});

    await service.linkedinCallback('code', userId);

    expect(
      mocks.featureGatingService.assertConnectedAccountCapacity,
    ).toHaveBeenCalledWith({
      userId,
      isReconnect: false,
    });
    expect(mocks.connectedAccountModel.findOneAndUpdate).toHaveBeenCalled();
    const updatePayload = mocks.connectedAccountModel.findOneAndUpdate.mock.calls[0][1];
    expect(updatePayload.avatarUrlExpiresAt).toEqual(new Date(1711111111 * 1000));
    expect(updatePayload.profileMetadata.avatarUrl).toBeUndefined();
  });

  it('treats existing linked account as reconnect and bypasses capacity usage', async () => {
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
    mocks.connectedAccountModel.findOne.mockResolvedValue({
      profileMetadata: { sub: 'linkedin-sub' },
    });
    mocks.connectedAccountModel.findOneAndUpdate.mockResolvedValue({});

    await service.linkedinCallback('code', userId);

    expect(
      mocks.featureGatingService.assertConnectedAccountCapacity,
    ).toHaveBeenCalledWith({
      userId,
      isReconnect: true,
    });
    expect(mocks.connectedAccountModel.findOne).toHaveBeenCalledWith({
      user: new Types.ObjectId(userId),
      provider: AccountProvider.LINKEDIN,
      $or: [
        { accountType: LinkedinAccountType.PERSON },
        { accountType: { $exists: false } },
      ],
    });
  });

  it('returns false when reconnecting with a different LinkedIn identity', async () => {
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
    mocks.connectedAccountModel.findOne.mockResolvedValue({
      profileMetadata: { sub: 'existing-sub' },
    });

    const result = await service.linkedinCallback('code', userId);

    expect(result).toBe(false);
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
    mocks.connectedAccountModel.findOne.mockResolvedValue({
      profileMetadata: { sub: 'legacy-sub' },
    });
    mocks.connectedAccountModel.findOneAndUpdate.mockResolvedValue({});

    const result = await service.linkedinCallback('code', userId);

    expect(result).toBe(true);
    expect(mocks.connectedAccountModel.findOneAndUpdate).toHaveBeenCalled();
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
