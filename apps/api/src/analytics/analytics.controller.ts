import {
  Controller,
  Get,
  HttpStatus,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk';
import { GetUser } from '../common/decorators';
import type { IAppResponse } from '../common/interfaces';
import type { User } from '../database/schemas/user.schema';
import { AnalyticsService } from './analytics.service';
import { AnalyticsThrottlerGuard } from './analytics-throttler.guard';
import {
  AnalyticsAccountParamsDto,
  AnalyticsRangeQueryDto,
  AnalyticsRefreshQueryDto,
} from './dto';

/**
 * LinkedIn analytics for one of the caller's connected accounts
 * (`docs/api/analytics.md`). `AnalyticsThrottlerGuard` is `UserThrottlerGuard`
 * with a tighter bucket for `refresh=true`.
 */
@UseGuards(ClerkAuthGuard, AnalyticsThrottlerGuard)
@Controller('analytics/accounts/:connectedAccountId')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  async getOverview(
    @GetUser() user: User,
    @Param() params: AnalyticsAccountParamsDto,
    @Query() query: AnalyticsRangeQueryDto,
  ): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.OK,
      message: 'Analytics overview retrieved successfully',
      data: await this.analyticsService.getOverview(
        user,
        params.connectedAccountId,
        query.range,
        query.refresh === true,
      ),
    };
  }

  @Get('posts')
  async getPosts(
    @GetUser() user: User,
    @Param() params: AnalyticsAccountParamsDto,
    @Query() query: AnalyticsRangeQueryDto,
  ): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.OK,
      message: 'Analytics posts retrieved successfully',
      data: await this.analyticsService.getPosts(
        user,
        params.connectedAccountId,
        query.range,
        query.refresh === true,
      ),
    };
  }

  @Get('audience')
  async getAudience(
    @GetUser() user: User,
    @Param() params: AnalyticsAccountParamsDto,
    @Query() query: AnalyticsRefreshQueryDto,
  ): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.OK,
      message: 'Analytics audience retrieved successfully',
      data: await this.analyticsService.getAudience(
        user,
        params.connectedAccountId,
        query.refresh === true,
      ),
    };
  }
}
