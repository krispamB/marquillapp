import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ModifyResult } from 'mongoose';
import type { ClerkClient, User as ClerkUser } from '@clerk/backend';
import { User } from '../../database/schemas/user.schema';
import { Tier } from '../../database/schemas/tier.schema';
import { EmailQueue } from '../../workflow/email.queue';
import { CLERK_CLIENT } from './clerk.client';

/**
 * Maps a verified Clerk identity to the local Mongo `User`.
 *
 * Lazy provisioning: resolve by `clerkId`, then fall back to `email` so existing
 * Google users keep their `_id` (and all drafts / subscriptions / connected
 * accounts), then create as a last resort. The Clerk Backend API is only hit on
 * the first request for a given identity (when `clerkId` is not yet linked).
 */
@Injectable()
export class UserProvisioningService {
  private readonly logger = new Logger(UserProvisioningService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Tier.name) private readonly tierModel: Model<Tier>,
    @Inject(CLERK_CLIENT) private readonly clerkClient: ClerkClient,
    private readonly emailQueue: EmailQueue,
  ) {}

  async findOrCreate(clerkUserId: string): Promise<User> {
    const existing = await this.userModel.findOne({ clerkId: clerkUserId });
    if (existing) {
      return existing;
    }

    const clerkUser = await this.clerkClient.users.getUser(clerkUserId);
    const email = this.resolveVerifiedEmail(clerkUser);
    const name = this.resolveName(clerkUser);
    const avatar = clerkUser.imageUrl ?? undefined;

    const emailOwner = await this.userModel.findOne({ email });
    if (emailOwner) {
      return this.linkEmailOwner(emailOwner, clerkUserId, avatar);
    }

    const defaultTier = await this.tierModel.findOne({ isDefault: true });
    let result: ModifyResult<User>;
    try {
      result = await this.userModel.findOneAndUpdate(
        { clerkId: clerkUserId },
        {
          $setOnInsert: {
            clerkId: clerkUserId,
            email,
            name,
            avatar,
            tier: defaultTier ? defaultTier._id : undefined,
          },
        },
        {
          includeResultMetadata: true,
          new: true,
          setDefaultsOnInsert: true,
          upsert: true,
        },
      );
    } catch (error) {
      if (!this.isDuplicateKeyError(error)) {
        throw error;
      }
      return this.resolveDuplicateRace(clerkUserId, email, avatar);
    }

    const user = result.value;
    if (!user) {
      throw new InternalServerErrorException(
        'Clerk user provisioning did not return a user',
      );
    }

    if (result.lastErrorObject?.upserted) {
      try {
        await this.emailQueue.addWelcomeEmailJob(email, name);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown queue error';
        this.logger.warn(
          `Welcome email enqueue failed for new Clerk signup (${email}): ${message}`,
        );
      }
    }

    return user;
  }

  private async linkEmailOwner(
    emailOwner: User,
    clerkUserId: string,
    avatar?: string,
  ): Promise<User> {
    if (emailOwner.clerkId && emailOwner.clerkId !== clerkUserId) {
      throw this.emailOwnershipConflict();
    }

    const update: { clerkId: string; avatar?: string } = {
      clerkId: clerkUserId,
    };
    if (!emailOwner.avatar && avatar) {
      update.avatar = avatar;
    }

    const linked = await this.userModel.findOneAndUpdate(
      {
        _id: emailOwner._id,
        $or: [
          { clerkId: { $exists: false } },
          { clerkId: null },
          { clerkId: clerkUserId },
        ],
      },
      { $set: update },
      { new: true },
    );
    if (linked) {
      return linked;
    }

    const winner = await this.userModel.findOne({ clerkId: clerkUserId });
    if (winner) {
      return winner;
    }
    throw this.emailOwnershipConflict();
  }

  private async resolveDuplicateRace(
    clerkUserId: string,
    email: string,
    avatar?: string,
  ): Promise<User> {
    const clerkWinner = await this.userModel.findOne({
      clerkId: clerkUserId,
    });
    if (clerkWinner) {
      return clerkWinner;
    }

    const emailWinner = await this.userModel.findOne({ email });
    if (emailWinner) {
      return this.linkEmailOwner(emailWinner, clerkUserId, avatar);
    }

    throw new InternalServerErrorException(
      'Unable to resolve concurrent Clerk user provisioning',
    );
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 11000
    );
  }

  private emailOwnershipConflict(): ConflictException {
    return new ConflictException({
      message: 'This email is already linked to another Clerk identity.',
      code: 'CLERK_EMAIL_ALREADY_LINKED',
    });
  }

  /**
   * The email a Clerk identity may claim: its primary address if verified,
   * otherwise any other verified address. An existing Marquill user is linked
   * by email, so an unverified address would let anyone who types in a
   * victim's email take over the victim's account.
   */
  private resolveVerifiedEmail(clerkUser: ClerkUser): string {
    const verified = clerkUser.emailAddresses.filter(
      (entry) => entry.verification?.status === 'verified',
    );
    const email = (
      verified.find((entry) => entry.id === clerkUser.primaryEmailAddressId) ??
      verified[0]
    )?.emailAddress;
    if (!email) {
      throw new ForbiddenException({
        message: 'Verify your email address to continue.',
        code: 'CLERK_EMAIL_UNVERIFIED',
      });
    }
    return email;
  }

  private resolveName(clerkUser: ClerkUser): string {
    const fullName = [clerkUser.firstName, clerkUser.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    return fullName || clerkUser.username || 'New User';
  }
}
