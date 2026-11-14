import { BadRequestException } from '@nestjs/common';
import { LinkedinAccountType } from '../database/schemas/connected-account.schema';
import { resolveLinkedinAuthorUrn } from './linkedin-author-urn';

describe('resolveLinkedinAuthorUrn', () => {
  it('should return the organization URN when the account is an organization', () => {
    expect(
      resolveLinkedinAuthorUrn({
        accountType: LinkedinAccountType.ORGANIZATION,
        externalId: '123',
      }),
    ).toBe('urn:li:organization:123');
  });

  it('should fall back to the stored organization URN when there is no external id', () => {
    expect(
      resolveLinkedinAuthorUrn({
        profileMetadata: { organizationUrn: 'urn:li:organization:9' },
      }),
    ).toBe('urn:li:organization:9');
  });

  it('should return the person URN from the profile sub when the account is a person', () => {
    expect(
      resolveLinkedinAuthorUrn({
        accountType: LinkedinAccountType.PERSON,
        profileMetadata: { sub: 'abc' },
        externalId: 'other',
      }),
    ).toBe('urn:li:person:abc');
  });

  it('should throw when no identifier is present', () => {
    expect(() =>
      resolveLinkedinAuthorUrn({ accountType: LinkedinAccountType.PERSON }),
    ).toThrow(BadRequestException);
  });
});
