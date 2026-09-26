import { BadRequestException, ConflictException } from '@nestjs/common';
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

import { AuthController } from './auth.controller';

describe('AuthController linkedin callback html responses', () => {
  const buildRes = () => {
    const res = {
      status: jest.fn(),
      type: jest.fn(),
      send: jest.fn(),
      setHeader: jest.fn(),
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
    expect(res.send).toHaveBeenCalledWith(
      expect.stringContaining('<!doctype html>'),
    );
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
    const [, csp] = res.setHeader.mock.calls[0] as [string, string];
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Security-Policy',
      expect.stringContaining("default-src 'none'"),
    );
    expect(res.send).toHaveBeenCalledWith(
      expect.stringContaining(`<script nonce="${nonce}">`),
    );
    expect(res.send).toHaveBeenCalledWith(
      expect.not.stringContaining('onclick='),
    );
    expect(res.send).toHaveBeenCalledWith(
      expect.not.stringContaining(
        'setTimeout(function () { window.close(); }, 60);',
      ),
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
      expect.stringContaining(
        'different LinkedIn account is already connected',
      ),
    );
  });

  it('returns 400 html page when the oauth state is invalid or expired', async () => {
    const { controller, authService } = makeController();
    const res = buildRes();
    authService.linkedinCallback.mockRejectedValue(
      new BadRequestException({
        message: 'invalid state',
        code: 'LINKEDIN_OAUTH_STATE_INVALID',
      }),
    );

    await controller.linkedinAuthRedirect('code', 'forged', res as any);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.type).toHaveBeenCalledWith('html');
    expect(res.send).toHaveBeenCalledWith(
      expect.stringContaining('invalid or has expired'),
    );
  });

  it('returns 400 html page when linkedin returns no authorization code', async () => {
    const { controller, authService } = makeController();
    const res = buildRes();
    authService.linkedinCallback.mockRejectedValue(
      new BadRequestException({
        message: 'incomplete',
        code: 'LINKEDIN_AUTHORIZATION_INCOMPLETE',
      }),
    );

    await controller.linkedinAuthRedirect(undefined, 'state', res as any);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith(
      expect.stringContaining('authorization was not completed'),
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
