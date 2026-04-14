import {
  BadRequestException,
  ConflictException,
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
} from '../database/schemas/connected-account.schema';
import { User } from '../database/schemas/user.schema';
import { Tier } from '../database/schemas/tier.schema';
import { ConfigService } from '@nestjs/config';
import { ApiError, apiFetch } from 'src/common/HelperFn';
import { EncryptionService } from '../encryption/encryption.service';
import { FeatureGatingService } from '../feature-gating';
import { LinkedinAvatarRefreshQueue } from '../workflow/linkedin-avatar-refresh.queue';
import { ScheduleQueue } from '../workflow/schedule.queue';
import { EmailQueue } from '../workflow/email.queue';

interface LinkedinUserInfo {
  memberId: string;
  displayName: string;
  localizedFirstName?: string;
  localizedLastName?: string;
  localizedHeadline?: string;
  vanityName?: string;
  displayImageUrn?: string;
  avatarUrl?: string;
  avatarUrlExpiresAt?: Date;
  profileMetadata: Record<string, any>;
}

interface LinkedinOrganizationAclElement {
  organization: string;
  role: string;
  state: string;
}

interface LinkedinOrganizationDetails {
  id: number;
  localizedName?: string;
  logoV2?: {
    'original~'?: {
      elements?: Array<{
        identifiers?: Array<{
          identifier?: string;
        }>;
      }>;
    };
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly LINKEDIN_API_BASE = 'https://api.linkedin.com/rest';
  private readonly AVATAR_REFRESH_LEAD_TIME_MS = 24 * 60 * 60 * 1000;
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
    @InjectModel('PostDraft')
    private readonly postDraftModel: Model<any>,
    @InjectModel(Tier.name) private tierModel: Model<Tier>,
    private configService: ConfigService,
    private encryptionService: EncryptionService,
    private readonly featureGatingService: FeatureGatingService,
    private readonly linkedinAvatarRefreshQueue: LinkedinAvatarRefreshQueue,
    private readonly scheduleQueue: ScheduleQueue,
    private readonly emailQueue: EmailQueue,
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

        try {
          await this.emailQueue.addWelcomeEmailJob(email, name);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown queue error';
          this.logger.warn(
            `Welcome email enqueue failed for new signup (${email}): ${message}`,
          );
        }
      }
    }

    return user;
  }

  login(user: User) {
    const payload = { email: user.email, sub: user._id.toString() };
    return {
      access_token: this.jwtService.sign(payload, {
        expiresIn: 30 * 24 * 60 * 60 * 1000,
      }),
    };
  }

  createLinkedinOath(user: User): string {
    return `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${this.configService.getOrThrow<string>('LINKEDIN_CLIENT_ID')}&redirect_uri=${this.configService.getOrThrow<string>('LINKEDIN_REDIRECT_URI')}&state=${user._id.toString()}&scope=${encodeURIComponent('openid profile email w_member_social r_basicprofile r_organization_admin rw_organization_admin w_organization_social r_organization_social')}&enable_extended_login=true`;
  }

  async linkedinCallback(code: string, state: string) {
    const { access_token, expires_in } =
      await this.getLinkedinAccessToken(code);
    const profileMetadata = await this.getLinkedinUser(access_token);
    const encryptedAccessToken =
      await this.encryptionService.encrypt(access_token);

    const memberOwnerAccount = await this.getLinkedinPersonalAccountByMemberId(
      profileMetadata.memberId,
    );
    if (
      memberOwnerAccount &&
      !this.isAccountOwnedByUser(memberOwnerAccount, state)
    ) {
      throw new ConflictException({
        message: 'This LinkedIn account is already connected to another user.',
        code: 'LINKEDIN_ACCOUNT_ALREADY_CONNECTED',
      });
    }

    const connectedAccount = await this.getLinkedinPersonalAccount(state);
    const existingMemberId = this.getStoredLinkedinMemberId(connectedAccount);
    if (
      connectedAccount &&
      connectedAccount.isActive &&
      existingMemberId &&
      existingMemberId !== profileMetadata.memberId
    ) {
      throw new ConflictException({
        message:
          'A different LinkedIn account is already connected to this user.',
        code: 'LINKEDIN_ACCOUNT_MISMATCH',
      });
    }

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
        externalId: profileMetadata.memberId,
        displayName: profileMetadata.displayName,
        avatarUrl: profileMetadata.avatarUrl,
        avatarUrlExpiresAt: profileMetadata.avatarUrlExpiresAt,
        impersonatorUrn: `urn:li:person:${profileMetadata.memberId}`,
        accessToken: encryptedAccessToken,
        accessTokenExpiresAt: new Date(Date.now() + expires_in * 1000),
        profileMetadata: profileMetadata.profileMetadata,
        isActive: true,
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
          impersonatorUrn: `urn:li:person:${profileMetadata.memberId}`,
        },
      },
    );

    return true;
  }

  async getLinkedinOrganizations(userId: string) {
    await this.featureGatingService.assertCompanyPagesAccess(userId);

    const connectedAccount = await this.getLinkedinPersonalAccount(userId);
    if (!connectedAccount) {
      throw new NotFoundException('LinkedIn account not connected');
    }
    if (!connectedAccount.isActive || !connectedAccount.accessToken) {
      throw new BadRequestException(
        'Reconnect your LinkedIn account to fetch organizations',
      );
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

    const aclUrl = `${this.LINKEDIN_API_BASE}/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`;
    const { data } = await apiFetch<OrganizationAclResponse>(aclUrl, {
      method: 'GET',
      headers: {
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': '202601',
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const filtered = (data.elements ?? []).filter((element) =>
      this.LINKEDIN_ALLOWED_ORG_ROLES.has(element.role),
    );

    const enriched = await Promise.all(
      filtered.map(async (element) => {
        const organizationId = this.extractOrganizationId(element.organization);
        const orgDetails = await this.fetchLinkedinOrganizationDetails(
          organizationId,
          accessToken,
        );

        return {
          id: organizationId,
          urn: `urn:li:organization:${organizationId}`,
          role: element.role,
          state: element.state,
          name: orgDetails?.localizedName ?? `Organization ${organizationId}`,
          logoUrl: this.extractOrgLogoUrl(orgDetails),
        };
      }),
    );

    return enriched;
  }

  private async fetchLinkedinOrganizationDetails(
    organizationId: string,
    accessToken: string,
  ): Promise<LinkedinOrganizationDetails | null> {
    try {
      const url = `${this.LINKEDIN_API_BASE}/organizations/${organizationId}`;
      const { data } = await apiFetch<LinkedinOrganizationDetails>(url, {
        method: 'GET',
        headers: {
          'X-Restli-Protocol-Version': '2.0.0',
          'LinkedIn-Version': '202601',
          Authorization: `Bearer ${accessToken}`,
        },
      });
      return data;
    } catch (error) {
      this.logger.warn(
        `Failed to fetch details for organization ${organizationId}: ${error?.message}`,
      );
      return null;
    }
  }

  private extractOrgLogoUrl(
    orgDetails: LinkedinOrganizationDetails | null,
  ): string | null {
    return (
      orgDetails?.logoV2?.['original~']?.elements?.[0]?.identifiers?.[0]
        ?.identifier ?? null
    );
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
    const availableOrganizationMap = new Map(
      availableOrganizations.map((org) => [org.id, org]),
    );
    const disallowedOrganizationIds = uniqueOrganizationIds.filter(
      (organizationId) => !availableOrganizationMap.has(organizationId),
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
    if (!personalConnectedAccount.isActive || !personalConnectedAccount.accessToken) {
      throw new BadRequestException(
        'Reconnect your LinkedIn account before connecting organizations',
      );
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

      const orgDetails = availableOrganizationMap.get(organizationId);

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
          displayName: orgDetails?.name ?? `Organization ${organizationId}`,
          avatarUrl: orgDetails?.logoUrl ?? undefined,
          impersonatorUrn,
          accessToken: encryptedAccessToken,
          accessTokenExpiresAt,
          isActive: true,
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
    interface LinkedinLocalizedField {
      localized?: Record<string, string>;
      preferredLocale?: {
        country?: string;
        language?: string;
      };
    }

    interface LinkedinPictureIdentifier {
      identifier: string;
      identifierExpiresInSeconds?: string | number;
    }

    interface LinkedinPictureElement {
      data?: {
        'com.linkedin.digitalmedia.mediaartifact.StillImage'?: {
          storageSize?: { width?: number; height?: number };
          displaySize?: { width?: number; height?: number };
        };
      };
      identifiers?: LinkedinPictureIdentifier[];
    }

    interface LinkedinMeResponse {
      id: string;
      firstName?: LinkedinLocalizedField;
      lastName?: LinkedinLocalizedField;
      localizedFirstName?: string;
      localizedLastName?: string;
      headline?: LinkedinLocalizedField;
      localizedHeadline?: string;
      vanityName?: string;
      profilePicture?: {
        displayImage?: string;
        'displayImage~'?: {
          elements?: LinkedinPictureElement[];
        };
      };
    }

    const url =
      'https://api.linkedin.com/v2/me?projection=(id,firstName,lastName,localizedFirstName,localizedLastName,headline,localizedHeadline,vanityName,profilePicture(displayImage~digitalmediaAsset:playableStreams))';
    const { data: response } = await apiFetch<LinkedinMeResponse>(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${access_token}`,
      },
    });

    const firstName = this.resolveLocalizedValue(
      response.localizedFirstName,
      response.firstName,
    );
    const lastName = this.resolveLocalizedValue(
      response.localizedLastName,
      response.lastName,
    );
    const displayName = [firstName, lastName].filter(Boolean).join(' ').trim();

    const selectedImage = this.extractSmallestLinkedinImage(
      response.profilePicture?.['displayImage~']?.elements ?? [],
    );

    return {
      memberId: response.id,
      displayName: displayName || response.vanityName || response.id,
      localizedFirstName: response.localizedFirstName,
      localizedLastName: response.localizedLastName,
      localizedHeadline: response.localizedHeadline,
      vanityName: response.vanityName,
      displayImageUrn: response.profilePicture?.displayImage,
      avatarUrl: selectedImage?.url,
      avatarUrlExpiresAt: selectedImage?.expiresAt,
      profileMetadata: {
        // Legacy compatibility: existing logic and data may still use these keys.
        sub: response.id,
        memberId: response.id,
        localizedFirstName: response.localizedFirstName,
        localizedLastName: response.localizedLastName,
        localizedHeadline: response.localizedHeadline,
        displayImageUrn: response.profilePicture?.displayImage,
        vanityName: response.vanityName,
      },
    };
  }

  async getConnectedAccounts(userId: string) {
    try {
      const accounts = await this.connectedAccountModel
        .find({
          user: new Types.ObjectId(userId),
          isActive: true,
        })
        .select('-accessToken');

      this.enqueueLinkedinAvatarRefreshJobs(accounts);

      return accounts.map((account) =>
        this.sanitizeConnectedAccountAvatar(account),
      );
    } catch (error) {
      this.logger.error(error);
      throw new InternalServerErrorException(
        'An error occurred while fetching connected accounts',
      );
    }
  }

  async disconnectConnectedAccount(userId: string, connectedAccountId: string) {
    const userObjectId = new Types.ObjectId(userId);
    const targetAccount =
      await this.connectedAccountModel.findById(connectedAccountId);
    if (!targetAccount) {
      throw new NotFoundException('Connected account not found');
    }
    if (!this.isAccountOwnedByUser(targetAccount, userId)) {
      throw new ConflictException('Connected account is not owned by user');
    }
    if (targetAccount.provider !== AccountProvider.LINKEDIN) {
      throw new BadRequestException('Connected account must be LinkedIn');
    }

    const additionalFilter =
      targetAccount.accountType === LinkedinAccountType.PERSON
        ? {
            $or: [
              { _id: targetAccount._id },
              { accountType: LinkedinAccountType.ORGANIZATION },
            ],
          }
        : {
            _id: targetAccount._id,
          };

    const accountsToDeactivate = await this.connectedAccountModel
      .find({
        user: userObjectId,
        provider: AccountProvider.LINKEDIN,
        ...additionalFilter,
      })
      .select('_id');
    const accountIds = accountsToDeactivate.map((account) => account._id);
    const deactivatedCount = await this.connectedAccountModel.countDocuments({
      _id: { $in: accountIds },
      isActive: true,
    });
    const now = new Date();

    await this.connectedAccountModel.updateMany(
      { _id: { $in: accountIds } },
      {
        $set: {
          isActive: false,
          accessToken: null,
          accessTokenExpiresAt: null,
          avatarUrlExpiresAt: null,
          'profileMetadata.disconnectedAt': now,
          'profileMetadata.disconnectReason': 'USER_REQUESTED',
        },
      },
    );

    const scheduledPosts = await this.postDraftModel
      .find({
        user: userObjectId,
        connectedAccount: { $in: accountIds },
        status: 'SCHEDULED',
      })
      .select('_id');

    for (const post of scheduledPosts) {
      const scheduledJob = await this.scheduleQueue.queue.getJob(
        post._id.toString(),
      );
      if (scheduledJob) {
        await scheduledJob.remove();
      }
    }

    if (scheduledPosts.length > 0) {
      await this.postDraftModel.updateMany(
        {
          _id: {
            $in: scheduledPosts.map((post) => new Types.ObjectId(post._id)),
          },
        },
        {
          $set: {
            status: 'DRAFT',
            scheduledAt: null,
          },
        },
      );
    }

    return {
      accountId: targetAccount._id.toString(),
      deactivatedCount,
      scheduledPostsCanceled: scheduledPosts.length,
    };
  }

  async refreshLinkedinAvatarForAccount(connectedAccountId: string) {
    const connectedAccount =
      await this.connectedAccountModel.findById(connectedAccountId);
    if (!connectedAccount) {
      this.logger.debug(
        `Skipping avatar refresh; account not found (${connectedAccountId})`,
      );
      return;
    }

    if (
      !connectedAccount.isActive ||
      !this.isLinkedinPersonalAccount(connectedAccount)
    ) {
      this.logger.debug(
        `Skipping avatar refresh; account not eligible (${connectedAccountId})`,
      );
      return;
    }

    const displayImageUrn = connectedAccount.profileMetadata?.displayImageUrn;
    if (!displayImageUrn) {
      this.logger.debug(
        `Skipping avatar refresh; displayImageUrn missing (${connectedAccountId})`,
      );
      return;
    }
    if (!connectedAccount.accessToken) {
      this.logger.debug(
        `Skipping avatar refresh; access token missing (${connectedAccountId})`,
      );
      return;
    }

    let accessToken: string;
    try {
      accessToken = await this.encryptionService.decrypt(
        connectedAccount.accessToken,
      );
    } catch (error) {
      this.logger.warn(
        `Avatar refresh decrypt failed for account ${connectedAccountId}`,
      );
      await this.markAvatarRefreshAuthFailure(connectedAccountId, 'DECRYPT_FAILED');
      return;
    }

    try {
      const linkedinUser = await this.getLinkedinUser(accessToken);
      const metadata: Record<string, any> = {
        ...(connectedAccount.profileMetadata ?? {}),
        displayImageUrn: linkedinUser.displayImageUrn ?? displayImageUrn,
      };

      delete metadata.avatarRefreshNeeded;
      delete metadata.avatarRefreshFailedAt;
      delete metadata.avatarRefreshFailureReason;

      await this.connectedAccountModel.findByIdAndUpdate(connectedAccountId, {
        $set: {
          avatarUrl: linkedinUser.avatarUrl ?? null,
          avatarUrlExpiresAt: linkedinUser.avatarUrlExpiresAt ?? null,
          profileMetadata: metadata,
        },
      });

      this.logger.log(
        `Avatar refresh succeeded for account ${connectedAccountId}`,
      );
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.statusCode === 401 || error.statusCode === 403) {
          this.logger.warn(
            `Avatar refresh auth expired for account ${connectedAccountId}`,
          );
          await this.markAvatarRefreshAuthFailure(
            connectedAccountId,
            'AUTH_EXPIRED',
          );
          return;
        }

        if (error.statusCode === 429 || error.statusCode >= 500) {
          this.logger.warn(
            `Avatar refresh transient failure for account ${connectedAccountId}: ${error.statusCode}`,
          );
          throw error;
        }
      }

      this.logger.warn(
        `Avatar refresh transient failure for account ${connectedAccountId}`,
      );
      throw error;
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

  private async getLinkedinPersonalAccountByMemberId(
    memberId: string,
  ): Promise<ConnectedAccount | null> {
    return this.connectedAccountModel.findOne({
      provider: AccountProvider.LINKEDIN,
      $and: [
        {
          $or: [
            { accountType: LinkedinAccountType.PERSON },
            { accountType: { $exists: false } },
          ],
        },
        {
          $or: [
            { externalId: memberId },
            { 'profileMetadata.memberId': memberId },
            { 'profileMetadata.sub': memberId },
          ],
        },
      ],
    });
  }

  private isAccountOwnedByUser(
    connectedAccount: ConnectedAccount,
    userId: string,
  ): boolean {
    const connectedUser = connectedAccount.user as
      | Types.ObjectId
      | { _id?: Types.ObjectId | string }
      | undefined;
    const ownerId =
      connectedUser && typeof connectedUser === 'object' && '_id' in connectedUser
        ? connectedUser._id?.toString()
        : connectedUser?.toString();

    return ownerId === userId;
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

  private getStoredLinkedinMemberId(
    connectedAccount: ConnectedAccount | null,
  ): string | null {
    if (!connectedAccount) {
      return null;
    }

    return (
      connectedAccount.externalId ||
      connectedAccount.profileMetadata?.memberId ||
      connectedAccount.profileMetadata?.sub ||
      null
    );
  }

  private enqueueLinkedinAvatarRefreshJobs(accounts: ConnectedAccount[]) {
    const now = Date.now();
    const refreshDeadline = now + this.AVATAR_REFRESH_LEAD_TIME_MS;

    for (const account of accounts) {
      if (!this.shouldEnqueueLinkedinAvatarRefresh(account, refreshDeadline)) {
        continue;
      }

      this.linkedinAvatarRefreshQueue
        .addAvatarRefreshJob(account._id.toString())
        .then(() =>
          this.logger.debug(
            `Queued LinkedIn avatar refresh for account ${account._id.toString()}`,
          ),
        )
        .catch((error) =>
          this.logger.warn(
            `Failed to enqueue LinkedIn avatar refresh for account ${account._id.toString()}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    }
  }

  private sanitizeConnectedAccountAvatar(account: ConnectedAccount) {
    const serializedAccount =
      typeof (account as any).toObject === 'function'
        ? (account as any).toObject()
        : { ...account };

    if (!this.isLinkedinPersonalAccount(account)) {
      return serializedAccount;
    }

    if (this.isAvatarExpired(account.avatarUrlExpiresAt)) {
      serializedAccount.avatarUrl = null;
    }

    return serializedAccount;
  }

  private shouldEnqueueLinkedinAvatarRefresh(
    account: ConnectedAccount,
    refreshDeadline: number,
  ): boolean {
    if (!this.isLinkedinPersonalAccount(account)) {
      return false;
    }

    const displayImageUrn = account.profileMetadata?.displayImageUrn;
    if (!displayImageUrn) {
      return false;
    }

    if (!account.avatarUrl) {
      return true;
    }

    const expiresAtMs = this.parseExpiryToMs(account.avatarUrlExpiresAt);
    if (expiresAtMs === null) {
      return true;
    }

    return expiresAtMs <= refreshDeadline;
  }

  private isLinkedinPersonalAccount(account: ConnectedAccount): boolean {
    return (
      account.provider === AccountProvider.LINKEDIN &&
      (!account.accountType || account.accountType === LinkedinAccountType.PERSON)
    );
  }

  private isAvatarExpired(value?: Date): boolean {
    const expiresAtMs = this.parseExpiryToMs(value);
    if (expiresAtMs === null) {
      return false;
    }

    return expiresAtMs <= Date.now();
  }

  private parseExpiryToMs(value?: Date): number | null {
    if (!value) {
      return null;
    }

    const date = value instanceof Date ? value : new Date(value);
    const time = date.getTime();
    return Number.isFinite(time) ? time : null;
  }

  private async markAvatarRefreshAuthFailure(
    connectedAccountId: string,
    reason: 'AUTH_EXPIRED' | 'DECRYPT_FAILED',
  ) {
    const account = await this.connectedAccountModel.findById(connectedAccountId);
    if (!account) {
      return;
    }

    const profileMetadata = {
      ...(account.profileMetadata ?? {}),
      avatarRefreshNeeded: true,
      avatarRefreshFailedAt: new Date(),
      avatarRefreshFailureReason: reason,
    };

    await this.connectedAccountModel.findByIdAndUpdate(connectedAccountId, {
      $set: {
        avatarUrl: null,
        avatarUrlExpiresAt: null,
        profileMetadata,
      },
    });
  }

  private resolveLocalizedValue(
    localizedValue: string | undefined,
    localizedField?: {
      localized?: Record<string, string>;
      preferredLocale?: {
        country?: string;
        language?: string;
      };
    },
  ): string | undefined {
    if (localizedValue) {
      return localizedValue;
    }

    const preferredLocale = localizedField?.preferredLocale;
    if (preferredLocale?.language && preferredLocale?.country) {
      const localeKey = `${preferredLocale.language}_${preferredLocale.country}`;
      const preferred = localizedField?.localized?.[localeKey];
      if (preferred) {
        return preferred;
      }
    }

    return Object.values(localizedField?.localized ?? {})[0];
  }

  private extractSmallestLinkedinImage(
    elements: Array<{
      data?: {
        'com.linkedin.digitalmedia.mediaartifact.StillImage'?: {
          storageSize?: { width?: number; height?: number };
          displaySize?: { width?: number; height?: number };
        };
      };
      identifiers?: Array<{
        identifier: string;
        identifierExpiresInSeconds?: string | number;
      }>;
    }>,
  ): { url: string; expiresAt?: Date } | null {
    let smallest:
      | { url: string; area: number; index: number; expiresAt?: Date }
      | null = null;

    for (const [index, element] of elements.entries()) {
      const stillImage =
        element.data?.['com.linkedin.digitalmedia.mediaartifact.StillImage'];
      const width =
        stillImage?.storageSize?.width ?? stillImage?.displaySize?.width ?? 0;
      const height =
        stillImage?.storageSize?.height ?? stillImage?.displaySize?.height ?? 0;
      const area = width * height;

      const primaryIdentifier = element.identifiers?.[0];
      if (!primaryIdentifier?.identifier) {
        continue;
      }

      const expiresAt = this.parseLinkedinImageExpiry(
        primaryIdentifier.identifierExpiresInSeconds,
      );

      if (
        !smallest ||
        area < smallest.area ||
        (area === smallest.area && index < smallest.index)
      ) {
        smallest = {
          url: primaryIdentifier.identifier,
          area,
          index,
          expiresAt,
        };
      }
    }

    if (!smallest) {
      return null;
    }

    return {
      url: smallest.url,
      expiresAt: smallest.expiresAt,
    };
  }

  private parseLinkedinImageExpiry(
    value?: string | number,
  ): Date | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    const numericValue =
      typeof value === 'number' ? value : Number.parseInt(value, 10);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return undefined;
    }

    return new Date(numericValue * 1000);
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
