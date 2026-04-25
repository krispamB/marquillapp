import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  OnboardingProfile,
  User,
  UserType,
} from '../database/schemas';
import { InitOnboardingDto, UpdateOnboardingDto } from './dto';

@Injectable()
export class OnboardingService {
  constructor(
    @InjectModel(OnboardingProfile.name)
    private readonly onboardingModel: Model<OnboardingProfile>,
  ) {}

  async initOnboarding(user: User, dto: InitOnboardingDto) {
    const profile = await this.onboardingModel.findOneAndUpdate(
      { user: user._id },
      { userType: dto.userType, currentStep: 1, isComplete: false, data: {} },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    return profile;
  }

  async updateOnboardingStep(user: User, dto: UpdateOnboardingDto) {
    const profile = await this.onboardingModel.findOne({ user: user._id });
    if (!profile) {
      throw new NotFoundException('Onboarding profile not found');
    }

    if (dto.step !== profile.currentStep + 1) {
      throw new BadRequestException(
        `Expected step ${profile.currentStep + 1}, received step ${dto.step}`,
      );
    }

    const update = this.buildStepUpdate(profile.userType, dto);
    profile.data = { ...profile.data, ...update };
    profile.currentStep = dto.step;

    if (dto.step === 5) {
      profile.isComplete = true;
    }

    await profile.save();
    return profile;
  }

  async getOnboardingProfile(user: User) {
    const profile = await this.onboardingModel.findOne({ user: user._id });
    if (!profile) {
      throw new NotFoundException('Onboarding profile not found');
    }
    return profile;
  }

  private buildStepUpdate(
    userType: UserType,
    dto: UpdateOnboardingDto,
  ): Record<string, unknown> {
    switch (dto.step) {
      case 2:
        if (userType === UserType.CREATOR) {
          return { name: dto.name, creatorLevel: dto.creatorLevel };
        }
        return {
          name: dto.name,
          agencyName: dto.agencyName,
          numberOfClients: dto.numberOfClients,
        };
      case 3:
        if (userType === UserType.CREATOR) {
          return { goals: dto.goals };
        }
        return { clientGoal: dto.goals };
      case 4:
        return {
          postingFrequency: dto.postingFrequency,
          postingDays: dto.postingDays,
        };
      case 5:
        return { topics: dto.topics };
      default:
        return {};
    }
  }
}
