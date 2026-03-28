import { Types } from 'mongoose';
import {
  AccountProvider,
  LinkedinAccountType,
} from '../database/schemas/connected-account.schema';

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
      sub: 'linkedin-sub',
      email_verified: true,
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
  });

  it('treats existing linked account as reconnect and bypasses capacity usage', async () => {
    const { service, mocks } = makeService();
    const userId = new Types.ObjectId().toString();
    jest
      .spyOn(service as any, 'getLinkedinAccessToken')
      .mockResolvedValue({ access_token: 'access', expires_in: 3600 });
    jest.spyOn(service as any, 'getLinkedinUser').mockResolvedValue({
      sub: 'linkedin-sub',
      email_verified: true,
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
      sub: 'new-sub',
      email_verified: true,
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
});
