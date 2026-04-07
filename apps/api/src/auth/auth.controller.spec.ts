import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';

jest.mock(
  'src/common/HelperFn',
  () => ({
    apiFetch: jest.fn(),
    ApiError: class ApiError extends Error {},
  }),
  { virtual: true },
);

jest.mock('./auth.service', () => ({
  AuthService: class AuthService {},
}));

jest.mock('../database/schemas', () => ({
  User: class User {},
}));

jest.mock(
  'src/common/guards',
  () => ({
    JwtAuthGuard: class JwtAuthGuard {},
  }),
  { virtual: true },
);

import { AuthController } from './auth.controller';

describe('AuthController linkedin callback html responses', () => {
  const buildRes = () => {
    const res = {
      status: jest.fn(),
      type: jest.fn(),
      send: jest.fn(),
    };
    res.status.mockReturnValue(res);
    res.type.mockReturnValue(res);
    res.send.mockReturnValue(res);
    return res;
  };

  const makeController = () => {
    const authService = {
      linkedinCallback: jest.fn(),
      disconnectConnectedAccount: jest.fn(),
    };
    return {
      controller: new AuthController(authService as any),
      authService,
    };
  };

  it('returns success html page with 200', async () => {
    const { controller, authService } = makeController();
    const res = buildRes();
    authService.linkedinCallback.mockResolvedValue(true);

    await controller.linkedinAuthRedirect('code', 'state', res as any);

    expect(authService.linkedinCallback).toHaveBeenCalledWith('code', 'state');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.type).toHaveBeenCalledWith('html');
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('<!doctype html>'));
    expect(res.send).toHaveBeenCalledWith(
      expect.stringContaining('LinkedIn Connected'),
    );
    expect(res.send).toHaveBeenCalledWith(
      expect.stringContaining('window.close()'),
    );
    expect(res.send).toHaveBeenCalledWith(
      expect.stringContaining('Closing in 4s...'),
    );
    expect(res.send).toHaveBeenCalledWith(
      expect.stringContaining('shouldAutoClose'),
    );
    expect(res.send).toHaveBeenCalledWith(
      expect.not.stringContaining('setTimeout(function () { window.close(); }, 60);'),
    );
  });

  it('returns 409 html page for already connected conflict', async () => {
    const { controller, authService } = makeController();
    const res = buildRes();
    authService.linkedinCallback.mockRejectedValue(
      new ConflictException({
        message: 'already connected',
        code: 'LINKEDIN_ACCOUNT_ALREADY_CONNECTED',
      }),
    );

    await controller.linkedinAuthRedirect('code', 'state', res as any);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.type).toHaveBeenCalledWith('html');
    expect(res.send).toHaveBeenCalledWith(
      expect.stringContaining('already connected to another user'),
    );
  });

  it('returns 409 html page for mismatch conflict', async () => {
    const { controller, authService } = makeController();
    const res = buildRes();
    authService.linkedinCallback.mockRejectedValue(
      new ConflictException({
        message: 'mismatch',
        code: 'LINKEDIN_ACCOUNT_MISMATCH',
      }),
    );

    await controller.linkedinAuthRedirect('code', 'state', res as any);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.type).toHaveBeenCalledWith('html');
    expect(res.send).toHaveBeenCalledWith(
      expect.stringContaining('different LinkedIn account is already connected'),
    );
  });

  it('rethrows non-conflict errors', async () => {
    const { controller, authService } = makeController();
    const res = buildRes();
    const error = new Error('unexpected');
    authService.linkedinCallback.mockRejectedValue(error);

    await expect(
      controller.linkedinAuthRedirect('code', 'state', res as any),
    ).rejects.toThrow('unexpected');
    expect(res.send).not.toHaveBeenCalled();
  });

  it('disconnects connected account through auth service', async () => {
    const { controller, authService } = makeController();
    const summary = {
      accountId: 'acc-1',
      deactivatedCount: 2,
      scheduledPostsCanceled: 3,
    };
    authService.disconnectConnectedAccount.mockResolvedValue(summary);

    const response = await controller.disconnectConnectedAccount(
      { _id: new Types.ObjectId('507f1f77bcf86cd799439011') } as any,
      'acc-1',
    );

    expect(authService.disconnectConnectedAccount).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011',
      'acc-1',
    );
    expect(response).toEqual({
      statusCode: 200,
      message: 'Connected account disconnected successfully',
      data: summary,
    });
  });
});
