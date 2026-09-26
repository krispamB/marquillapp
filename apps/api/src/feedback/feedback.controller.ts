import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { GetUser } from '../common/decorators';
import { ClerkAuthGuard } from '../auth/clerk';
import { IAppResponse } from '../common/interfaces';
import { User } from '../database/schemas';
import { CreateFeedbackIssueDto } from './dto';
import { FeedbackService } from './feedback.service';
import { UserThrottlerGuard } from '../common/guards/user-throttler.guard';
import { Throttle, hours } from '@nestjs/throttler';

@UseGuards(ClerkAuthGuard, UserThrottlerGuard)
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  // Each report opens a GitHub issue with our token.
  @Throttle({ default: { limit: 10, ttl: hours(1) } })
  @Post('issues')
  @HttpCode(HttpStatus.CREATED)
  async submitIssue(
    @GetUser() user: User,
    @Body() dto: CreateFeedbackIssueDto,
  ): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.CREATED,
      message: 'Feedback submitted successfully',
      data: await this.feedbackService.submitIssue(user, dto),
    };
  }
}
