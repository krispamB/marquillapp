import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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
    const email = this.resolvePrimaryEmail(clerkUser);
    const name = this.resolveName(clerkUser);
    const avatar = clerkUser.imageUrl ?? undefined;

    if (email) {
      const linked = await this.userModel.findOne({ email });
      if (linked) {
        linked.clerkId = clerkUserId;
        if (!linked.avatar && avatar) {
          linked.avatar = avatar;
        }
        await linked.save();
        return linked;
      }
    }

    const defaultTier = await this.tierModel.findOne({ isDefault: true });
    const created = await this.userModel.create({
      clerkId: clerkUserId,
      email,
      name,
      avatar,
      tier: defaultTier ? defaultTier._id : undefined,
    });

    if (email) {
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

    return created;
  }

  private resolvePrimaryEmail(clerkUser: ClerkUser): string {
    const primary = clerkUser.emailAddresses.find(
      (entry) => entry.id === clerkUser.primaryEmailAddressId,
    );
    return (
      primary?.emailAddress ??
      clerkUser.emailAddresses[0]?.emailAddress ??
      ''
    );
  }

  private resolveName(clerkUser: ClerkUser): string {
    const fullName = [clerkUser.firstName, clerkUser.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    return fullName || clerkUser.username || 'New User';
  }
}
