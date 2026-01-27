import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ObjectId, Types } from 'mongoose';
import { AccountProvider, ConnectedAccount, User } from '../database/schemas';
import { ConfigService } from '@nestjs/config';
import { apiFetch } from 'src/common/HelperFn';
import { EncryptionService } from '../encryption/encryption.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    private jwtService: JwtService,
    @InjectModel(ConnectedAccount.name)
    private connectedAccountModel: Model<ConnectedAccount>,
    private configService: ConfigService,
    private encryptionService: EncryptionService,
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
        user = await this.userModel.create({
          email,
          name,
          avatar,
          googleId,
        });
      }
    }

    return user;
  }

  async login(user: User) {
    const payload = { email: user.email, sub: user._id.toString() };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }

  async createLinkedinOath(user: User): Promise<string> {
    return `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${this.configService.getOrThrow<string>('LINKEDIN_CLIENT_ID')}&redirect_uri=${this.configService.getOrThrow<string>('LINKEDIN_REDIRECT_URI')}&state=${user._id.toString()}&scope=${encodeURIComponent('openid profile email w_member_social')}`;
  }

  async linkedinCallback(code: string, state: string) {
    const { access_token, expires_in } =
      await this.getLinkedinAccessToken(code);
    const profileMetadata = await this.getLinkedinUser(access_token);
    const encryptedAccessToken =
      await this.encryptionService.encrypt(access_token);
    await this.connectedAccountModel.findOneAndUpdate(
      {
        user: state as unknown as ObjectId,
        provider: AccountProvider.LINKEDIN,
      },
      {
        accessToken: encryptedAccessToken,
        accessTokenExpiresAt: new Date(Date.now() + expires_in * 1000),
        profileMetadata,
      },
      { upsert: true },
    );

    return profileMetadata.email_verified;
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
    const response = await apiFetch<IResponse>(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: data,
    });
    return response;
  }

  private async getLinkedinUser(access_token: string) {
    const url = 'https://api.linkedin.com/v2/userinfo';
    interface IResponse {
      sub: string;
      name: string;
      given_name: string;
      family_name: string;
      picture: string;
      locale: string;
      email: string;
      email_verified: boolean;
    }
    const response = await apiFetch<IResponse>(url, {
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
}
