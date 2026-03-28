import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AccountProvider,
  ConnectedAccount,
  LinkedinAccountType,
} from '../database/schemas';
import { User } from '../database/schemas';
import { Tier } from '../database/schemas';
import { ConfigService } from '@nestjs/config';
import { apiFetch } from 'src/common/HelperFn';
import { EncryptionService } from '../encryption/encryption.service';
import { FeatureGatingService } from '../feature-gating';

interface LinkedinUserInfo {
  sub: string;
  name: string;
  given_name: string;
  family_name: string;
  picture: string;
  locale: string;
  email: string;
  email_verified: boolean;
}

interface LinkedinOrganizationAclElement {
  organization: string;
  role: string;
  state: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly LINKEDIN_API_BASE = 'https://api.linkedin.com/rest';
  private readonly LINKEDIN_ALLOWED_ORG_ROLES = new Set([
    'ADMINISTRATOR',
    'DIRECT_SPONSORED_CONTENT_POSTER',
    'CONTENT_ADMINISTRATOR',
  ]);

  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    private jwtService: JwtService,
    @InjectModel(ConnectedAccount.name)
    private connectedAccountModel: Model<ConnectedAccount>,
    @InjectModel(Tier.name) private tierModel: Model<Tier>,
    private configService: ConfigService,
    private encryptionService: EncryptionService,
    private readonly featureGatingService: FeatureGatingService,
  ) {}

  async validateGoogleUser(details: {
    email: string;
    name: string;
    avatar: string;
    googleId: string;
  }) {
    const { email, name, avatar, googleId } = details;
    let user = await this.userModel.findOne({ googleId });

    if (!user) {
      user = await this.userModel.findOne({ email });
      if (user) {
        user.googleId = googleId;
        user.avatar = avatar;
        await user.save();
      } else {
        const defaultTier = await this.tierModel.findOne({ isDefault: true });
        user = await this.userModel.create({
          email,
          name,
          avatar,
          googleId,
          tier: defaultTier ? defaultTier._id : undefined,
        });
      }
    }

    return user;
  }

  login(user: User) {
    const payload = { email: user.email, sub: user._id.toString() };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }

  createLinkedinOath(user: User): string {
    return `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${this.configService.getOrThrow<string>('LINKEDIN_CLIENT_ID')}&redirect_uri=${this.configService.getOrThrow<string>('LINKEDIN_REDIRECT_URI')}&state=${user._id.toString()}&scope=${encodeURIComponent('openid profile email w_member_social r_organization_admin rw_organization_admin')}&enable_extended_login=true`;
  }

  async linkedinCallback(code: string, state: string) {
    const { access_token, expires_in } =
      await this.getLinkedinAccessToken(code);
    const profileMetadata = await this.getLinkedinUser(access_token);
    const encryptedAccessToken =
      await this.encryptionService.encrypt(access_token);

    const connectedAccount = await this.getLinkedinPersonalAccount(state);
    if (
      connectedAccount &&
      connectedAccount.profileMetadata &&
      connectedAccount.profileMetadata['sub'] != profileMetadata.sub
    ) {
      return false;
    }

    await this.featureGatingService.assertConnectedAccountCapacity({
      userId: state,
      isReconnect: !!connectedAccount,
    });

    await this.connectedAccountModel.findOneAndUpdate(
      {
        user: new Types.ObjectId(state),
        provider: AccountProvider.LINKEDIN,
        $or: [
          { accountType: LinkedinAccountType.PERSON },
          { accountType: { $exists: false } },
        ],
      },
      {
        accountType: LinkedinAccountType.PERSON,
        externalId: profileMetadata.sub,
        displayName: profileMetadata.name,
        avatarUrl: profileMetadata.picture,
        impersonatorUrn: `urn:li:person:${profileMetadata.sub}`,
        accessToken: encryptedAccessToken,
        accessTokenExpiresAt: new Date(Date.now() + expires_in * 1000),
        profileMetadata,
      },
      { upsert: true },
    );
    await this.connectedAccountModel.updateMany(
      {
        user: new Types.ObjectId(state),
        provider: AccountProvider.LINKEDIN,
        accountType: LinkedinAccountType.ORGANIZATION,
      },
      {
        $set: {
          accessToken: encryptedAccessToken,
          accessTokenExpiresAt: new Date(Date.now() + expires_in * 1000),
          impersonatorUrn: `urn:li:person:${profileMetadata.sub}`,
        },
      },
    );

    return profileMetadata.email_verified;
  }

  async getLinkedinOrganizations(userId: string) {
    const connectedAccount = await this.getLinkedinPersonalAccount(userId);
    if (!connectedAccount) {
      throw new NotFoundException('LinkedIn account not connected');
    }

    const accessToken = await this.encryptionService.decrypt(
      connectedAccount.accessToken,
    );
    const memberUrn = this.resolveMemberUrn(connectedAccount);
    if (!memberUrn) {
      throw new BadRequestException(
        'Unable to resolve LinkedIn member identity from connected account',
      );
    }

    interface OrganizationAclResponse {
      elements: LinkedinOrganizationAclElement[];
    }

    const url = `${this.LINKEDIN_API_BASE}/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`;
    const { data } = await apiFetch<OrganizationAclResponse>(url, {
      method: 'GET',
      headers: {
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': '202601',
        Authorization: `Bearer ${accessToken}`,
      },
    });

    return (data.elements ?? [])
      .filter((element) => this.LINKEDIN_ALLOWED_ORG_ROLES.has(element.role))
      .map((element) => {
        const organizationId = this.extractOrganizationId(element.organization);

        return {
          id: organizationId,
          urn: `urn:li:organization:${organizationId}`,
          role: element.role,
          state: element.state,
        };
      });
  }

  async connectLinkedinOrganizations(
    userId: string,
    organizationIds: string[],
  ): Promise<ConnectedAccount[]> {
    if (!organizationIds.length) {
      throw new BadRequestException('organizationIds cannot be empty');
    }

    const uniqueOrganizationIds = [...new Set(organizationIds)].map((id) =>
      this.extractOrganizationId(id),
    );
    const availableOrganizations = await this.getLinkedinOrganizations(userId);
    const availableOrganizationIdSet = new Set(
      availableOrganizations.map((organization) => organization.id),
    );
    const disallowedOrganizationIds = uniqueOrganizationIds.filter(
      (organizationId) => !availableOrganizationIdSet.has(organizationId),
    );

    if (disallowedOrganizationIds.length) {
      throw new BadRequestException(
        `Unauthorized organizations: ${disallowedOrganizationIds.join(', ')}`,
      );
    }

    const personalConnectedAccount =
      await this.getLinkedinPersonalAccount(userId);
    if (!personalConnectedAccount) {
      throw new NotFoundException('LinkedIn account not connected');
    }

    const accessToken = await this.encryptionService.decrypt(
      personalConnectedAccount.accessToken,
    );
    const encryptedAccessToken =
      await this.encryptionService.encrypt(accessToken);
    const accessTokenExpiresAt = personalConnectedAccount.accessTokenExpiresAt;
    const impersonatorUrn = this.resolveMemberUrn(personalConnectedAccount);

    for (const organizationId of uniqueOrganizationIds) {
      const existingAccount = await this.connectedAccountModel.findOne({
        user: new Types.ObjectId(userId),
        provider: AccountProvider.LINKEDIN,
        accountType: LinkedinAccountType.ORGANIZATION,
        externalId: organizationId,
      });

      await this.featureGatingService.assertConnectedAccountCapacity({
        userId,
        isReconnect: !!existingAccount,
      });

      await this.connectedAccountModel.findOneAndUpdate(
        {
          user: new Types.ObjectId(userId),
          provider: AccountProvider.LINKEDIN,
          accountType: LinkedinAccountType.ORGANIZATION,
          externalId: organizationId,
        },
        {
          accountType: LinkedinAccountType.ORGANIZATION,
          externalId: organizationId,
          displayName: `Organization ${organizationId}`,
          impersonatorUrn,
          accessToken: encryptedAccessToken,
          accessTokenExpiresAt,
          profileMetadata: {
            organizationUrn: `urn:li:organization:${organizationId}`,
            connectedBy: impersonatorUrn,
          },
        },
        { upsert: true },
      );
    }

    return this.connectedAccountModel
      .find({
        user: new Types.ObjectId(userId),
        provider: AccountProvider.LINKEDIN,
        accountType: LinkedinAccountType.ORGANIZATION,
        externalId: { $in: uniqueOrganizationIds },
      })
      .select('-accessToken');
  }

  private async getLinkedinAccessToken(code: string) {
    const url = 'https://www.linkedin.com/oauth/v2/accessToken';
    const data = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: this.configService.getOrThrow<string>('LINKEDIN_CLIENT_ID'),
      client_secret: this.configService.getOrThrow<string>(
        'LINKEDIN_CLIENT_SECRET',
      ),
      redirect_uri: this.configService.getOrThrow<string>(
        'LINKEDIN_REDIRECT_URI',
      ),
    });

    interface IResponse {
      access_token: string;
      expires_in: number;
      scope: string;
    }
    const { data: result } = await apiFetch<IResponse>(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: data,
    });
    return result;
  }

  private async getLinkedinUser(
    access_token: string,
  ): Promise<LinkedinUserInfo> {
    const url = 'https://api.linkedin.com/v2/userinfo';
    const { data: response } = await apiFetch<LinkedinUserInfo>(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${access_token}`,
      },
    });
    return response;
  }

  async getConnectedAccounts(userId: string) {
    try {
      const accounts = await this.connectedAccountModel
        .find({
          user: new Types.ObjectId(userId),
        })
        .select('-accessToken');
      return accounts;
    } catch (error) {
      this.logger.error(error);
      throw new InternalServerErrorException(
        'An error occurred while fetching connected accounts',
      );
    }
  }

  private async getLinkedinPersonalAccount(
    userId: string,
  ): Promise<ConnectedAccount | null> {
    return this.connectedAccountModel.findOne({
      user: new Types.ObjectId(userId),
      provider: AccountProvider.LINKEDIN,
      $or: [
        { accountType: LinkedinAccountType.PERSON },
        { accountType: { $exists: false } },
      ],
    });
  }

  private resolveMemberUrn(connectedAccount: ConnectedAccount): string | null {
    const profileMetadataSub = connectedAccount.profileMetadata?.sub;
    if (profileMetadataSub) {
      return `urn:li:person:${profileMetadataSub}`;
    }

    if (connectedAccount.externalId) {
      return `urn:li:person:${connectedAccount.externalId}`;
    }

    if (connectedAccount.impersonatorUrn) {
      return connectedAccount.impersonatorUrn;
    }

    return null;
  }

  private extractOrganizationId(organizationIdentifier: string): string {
    if (!organizationIdentifier) {
      throw new BadRequestException('organizationId is required');
    }

    const organizationId =
      organizationIdentifier.split(':').pop()?.trim() ?? '';
    if (!organizationId) {
      throw new BadRequestException(
        `Invalid organization identifier: ${organizationIdentifier}`,
      );
    }

    return organizationId;
  }
}
