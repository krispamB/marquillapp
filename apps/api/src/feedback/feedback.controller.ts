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

@UseGuards(ClerkAuthGuard)
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

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
