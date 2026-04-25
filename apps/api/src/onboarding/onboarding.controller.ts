import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards';
import { GetUser } from '../common/decorators';
import { User } from '../database/schemas';
import { IAppResponse } from '../common/interfaces';
import { OnboardingService } from './onboarding.service';
import { InitOnboardingDto, UpdateOnboardingDto } from './dto';

@Controller('onboarding')
@UseGuards(JwtAuthGuard)
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Post()
  async initOnboarding(
    @GetUser() user: User,
    @Body() dto: InitOnboardingDto,
  ): Promise<IAppResponse> {
    const data = await this.onboardingService.initOnboarding(user, dto);
    return {
      statusCode: HttpStatus.CREATED,
      message: 'Onboarding profile created',
      data,
    };
  }

  @Patch()
  async updateStep(
    @GetUser() user: User,
    @Body() dto: UpdateOnboardingDto,
  ): Promise<IAppResponse> {
    const data = await this.onboardingService.updateOnboardingStep(user, dto);
    return {
      statusCode: HttpStatus.OK,
      message: `Step ${dto.step} saved`,
      data,
    };
  }

  @Get()
  async getProfile(@GetUser() user: User): Promise<IAppResponse> {
    const data = await this.onboardingService.getOnboardingProfile(user);
    return {
      statusCode: HttpStatus.OK,
      message: 'Onboarding profile fetched',
      data,
    };
  }
}
