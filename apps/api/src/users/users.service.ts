import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ThemePreference, User } from '../database/schemas/user.schema';
import { Tier } from '../database/schemas/tier.schema';
import { UpdatePreferencesDto } from './dto';

export interface ResolvedPreferences {
  theme: ThemePreference;
  timezone: string | null;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Tier.name) private tierModel: Model<Tier>,
  ) {}

  async updateUserTier(userId: string, tierId: string): Promise<User> {
    const tier = await this.tierModel.findById(tierId);
    if (!tier) {
      throw new NotFoundException('Tier not found');
    }

    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { tier: new Types.ObjectId(tierId) },
      { new: true },
    );

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  /**
   * Applies a partial preferences update. A field left out is kept; a
   * `null` timezone clears the stored value so the browser's is used again.
   */
  async updatePreferences(
    userId: string,
    dto: UpdatePreferencesDto,
  ): Promise<ResolvedPreferences> {
    const set: Record<string, string> = {};
    const unset: Record<string, ''> = {};

    if (dto.theme !== undefined) set['preferences.theme'] = dto.theme;
    if (dto.timezone === null) unset['preferences.timezone'] = '';
    else if (dto.timezone !== undefined)
      set['preferences.timezone'] = dto.timezone;

    const update: Record<string, Record<string, string>> = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;

    const user = Object.keys(update).length
      ? await this.userModel.findByIdAndUpdate(userId, update, { new: true })
      : await this.userModel.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return resolvePreferences(user);
  }
}

export function resolvePreferences(
  user: Pick<User, 'preferences'>,
): ResolvedPreferences {
  return {
    theme: user.preferences?.theme ?? ThemePreference.SYSTEM,
    timezone: user.preferences?.timezone ?? null,
  };
}
