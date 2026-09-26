import { ExecutionContext } from '@nestjs/common';
import { ClerkAuthGuard } from './clerk-auth.guard';

const verifyToken = jest.fn();
jest.mock(
  '@clerk/backend',
  () => ({ verifyToken: (...args: any[]) => verifyToken(...args) }),
  {
    virtual: true,
  },
);

const makeContext = (request: any): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

const makeGuard = () => {
  const pem = '-----BEGIN PUBLIC KEY-----\nabc123\n-----END PUBLIC KEY-----';
  const configService = {
    getOrThrow: jest.fn((key: string) =>
      key === 'CLERK_SECRET_KEY' ? 'sk_test_123' : undefined,
    ),
    get: jest.fn((key: string) => {
      if (key === 'FRONTEND_URL') return 'https://app.example.com';
      if (key === 'CLERK_JWT_KEY') return pem;
      return undefined;
    }),
  };
  const userProvisioning = { findOrCreate: jest.fn() };
  const jwtAuthGuard = { canActivate: jest.fn() };

  const guard = new ClerkAuthGuard(
    configService as any,
    userProvisioning as any,
    jwtAuthGuard as any,
  );

  return { guard, mocks: { configService, userProvisioning, jwtAuthGuard } };
};

describe('ClerkAuthGuard', () => {
  let guard: ClerkAuthGuard;
  let mocks: ReturnType<typeof makeGuard>['mocks'];

  beforeEach(() => {
    jest.clearAllMocks();
    ({ guard, mocks } = makeGuard());
  });

  describe('canActivate', () => {
    it('should verify the __session cookie, provision, and attach the local user', async () => {
      const user = { _id: 'mongo_1' };
      const request: any = { cookies: { __session: 'clerk.jwt' }, headers: {} };
      verifyToken.mockResolvedValueOnce({ sub: 'user_clerk_1' });
      mocks.userProvisioning.findOrCreate.mockResolvedValueOnce(user);

      await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);

      expect(verifyToken).toHaveBeenCalledWith('clerk.jwt', {
        secretKey: 'sk_test_123',
        authorizedParties: ['https://app.example.com'],
        jwtKey: expect.stringContaining('BEGIN PUBLIC KEY'),
      });
      expect(mocks.userProvisioning.findOrCreate).toHaveBeenCalledWith(
        'user_clerk_1',
      );
      expect(request.user).toBe(user);
      expect(mocks.jwtAuthGuard.canActivate).not.toHaveBeenCalled();
    });

    it('should omit jwtKey and verify via secretKey when CLERK_JWT_KEY is not a real PEM', async () => {
      mocks.configService.get.mockImplementation((key: string) => {
        if (key === 'FRONTEND_URL') return 'https://app.example.com';
        if (key === 'CLERK_JWT_KEY') return 'change_me';
        return undefined;
      });
      const request: any = { cookies: { __session: 'clerk.jwt' }, headers: {} };
      verifyToken.mockResolvedValueOnce({ sub: 'user_clerk_3' });
      mocks.userProvisioning.findOrCreate.mockResolvedValueOnce({ _id: 'm3' });

      await guard.canActivate(makeContext(request));

      expect(verifyToken).toHaveBeenCalledWith('clerk.jwt', {
        secretKey: 'sk_test_123',
        authorizedParties: ['https://app.example.com'],
      });
      const [, options] = verifyToken.mock.calls[0];
      expect(options).not.toHaveProperty('jwtKey');
    });

    it('should read the token from the Authorization header when no cookie is present', async () => {
      const request: any = {
        cookies: {},
        headers: { authorization: 'Bearer header.jwt' },
      };
      verifyToken.mockResolvedValueOnce({ sub: 'user_clerk_2' });
      mocks.userProvisioning.findOrCreate.mockResolvedValueOnce({ _id: 'm2' });

      await guard.canActivate(makeContext(request));

      expect(verifyToken).toHaveBeenCalledWith('header.jwt', expect.anything());
    });

    it('should fall back to the legacy JwtAuthGuard when no Clerk token is present', async () => {
      const request: any = { cookies: {}, headers: {} };
      mocks.jwtAuthGuard.canActivate.mockResolvedValueOnce(true);

      await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);

      expect(verifyToken).not.toHaveBeenCalled();
      expect(mocks.jwtAuthGuard.canActivate).toHaveBeenCalledTimes(1);
    });

    it('should fall back to the legacy JwtAuthGuard when Clerk verification fails', async () => {
      const request: any = { cookies: { __session: 'bad.jwt' }, headers: {} };
      verifyToken.mockRejectedValueOnce(new Error('expired'));
      mocks.jwtAuthGuard.canActivate.mockResolvedValueOnce(true);

      await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);

      expect(mocks.userProvisioning.findOrCreate).not.toHaveBeenCalled();
      expect(mocks.jwtAuthGuard.canActivate).toHaveBeenCalledTimes(1);
    });

    it('should propagate provisioning failures without using the legacy fallback', async () => {
      const request: any = {
        cookies: { __session: 'valid.jwt' },
        headers: {},
      };
      const provisioningError = new Error('database unavailable');
      verifyToken.mockResolvedValueOnce({ sub: 'user_clerk_4' });
      mocks.userProvisioning.findOrCreate.mockRejectedValueOnce(
        provisioningError,
      );

      await expect(guard.canActivate(makeContext(request))).rejects.toBe(
        provisioningError,
      );

      expect(mocks.jwtAuthGuard.canActivate).not.toHaveBeenCalled();
    });
  });
});
