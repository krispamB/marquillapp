import { isLinkedinAccessUsable } from './linkedin-access.helper';

describe('isLinkedinAccessUsable', () => {
  const now = new Date('2026-08-11T08:00:00.000Z').getTime();

  it('should accept active access with a future expiry', () => {
    expect(
      isLinkedinAccessUsable(
        {
          isActive: true,
          accessToken: 'encrypted-token',
          accessTokenExpiresAt: new Date(now + 1),
        },
        now,
      ),
    ).toBe(true);
  });

  it('should reject access expiring exactly now', () => {
    expect(
      isLinkedinAccessUsable(
        {
          isActive: true,
          accessToken: 'encrypted-token',
          accessTokenExpiresAt: new Date(now),
        },
        now,
      ),
    ).toBe(false);
  });

  it('should reject access with a past expiry', () => {
    expect(
      isLinkedinAccessUsable(
        {
          isActive: true,
          accessToken: 'encrypted-token',
          accessTokenExpiresAt: new Date(now - 1),
        },
        now,
      ),
    ).toBe(false);
  });

  it('should accept legacy access without an expiry', () => {
    expect(
      isLinkedinAccessUsable(
        { isActive: true, accessToken: 'encrypted-token' },
        now,
      ),
    ).toBe(true);
  });

  it('should reject a malformed stored expiry', () => {
    expect(
      isLinkedinAccessUsable(
        {
          isActive: true,
          accessToken: 'encrypted-token',
          accessTokenExpiresAt: 'not-a-date',
        },
        now,
      ),
    ).toBe(false);
  });

  it.each([
    { isActive: false, accessToken: 'encrypted-token' },
    { isActive: true, accessToken: null },
  ])('should reject inactive or missing-token access', (account) => {
    expect(isLinkedinAccessUsable(account, now)).toBe(false);
  });
});
