import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk';
import { GetUser } from '../common/decorators';
import { User } from '../database/schemas';
import { UserThrottlerGuard } from '../common/guards/user-throttler.guard';
import { UpdatePreferencesDto } from './dto';
import { UsersService } from './users.service';

@UseGuards(ClerkAuthGuard, UserThrottlerGuard)
@Controller('users')
export class UserController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMe(@GetUser() user: User) {
    return user;
  }

  @Patch('me/preferences')
  updatePreferences(@GetUser() user: User, @Body() dto: UpdatePreferencesDto) {
    return this.usersService.updatePreferences(String(user._id), dto);
  }
}
