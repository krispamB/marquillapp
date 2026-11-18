import { BadRequestException } from '@nestjs/common';
import { LinkedinAccountType } from '../database/schemas/connected-account.schema';

export interface LinkedinAuthorAccount {
  accountType?: LinkedinAccountType;
  externalId?: string;
  impersonatorUrn?: string;
  profileMetadata?: { sub?: string; organizationUrn?: string };
}

/**
 * The URN a connected account posts and reads analytics as:
 * `urn:li:organization:{id}` for a page, `urn:li:person:{sub}` for a member.
 */
export function resolveLinkedinAuthorUrn(
  connectedAccount: LinkedinAuthorAccount,
): string {
  if (
    connectedAccount.accountType === LinkedinAccountType.ORGANIZATION ||
    connectedAccount.profileMetadata?.organizationUrn
  ) {
    const organizationId =
      connectedAccount.externalId ??
      connectedAccount.profileMetadata?.organizationUrn?.split(':').pop();
    if (!organizationId) {
      throw new BadRequestException(
        'Connected organization account is missing organization identifier',
      );
    }
    return `urn:li:organization:${organizationId}`;
  }

  const profileSub =
    connectedAccount.profileMetadata?.sub ??
    connectedAccount.externalId ??
    connectedAccount.impersonatorUrn?.split(':').pop();
  if (!profileSub) {
    throw new BadRequestException(
      'Connected personal account is missing LinkedIn profile identifier',
    );
  }

  return `urn:li:person:${profileSub}`;
}
