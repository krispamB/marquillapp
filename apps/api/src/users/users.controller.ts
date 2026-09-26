import { Controller, Get, UseGuards } from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk';
import { GetUser } from '../common/decorators';
import { User } from '../database/schemas';
import { UserThrottlerGuard } from '../common/guards/user-throttler.guard';

@UseGuards(ClerkAuthGuard, UserThrottlerGuard)
@Controller('users')
export class UserController {
  @Get('me')
  getMe(@GetUser() user: User) {
    return user;
  }
}
