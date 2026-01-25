import {
  Controller,
  Get,
  UseGuards,
  Res,
  Post,
  Req,
  Query,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { GetUser } from '../common/decorators';
import { User } from '../database/schemas';
import { JwtAuthGuard } from 'src/common/guards';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleAuth(@GetUser() user: User) {}

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthRedirect(@GetUser() user: User, @Res() res: Response) {
    const jwt = await this.authService.login(user);
    res.cookie('access_token', jwt.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 1 day
    });
    return res.redirect(`${process.env.FRONTEND_URL}`);
  }

  @Post('logout')
  logout(@Res() res: Response) {
    res.clearCookie('access_token');
    return { message: 'Logged out successfully' };
  }

  @UseGuards(JwtAuthGuard)
  @Get('linkedin')
  linkedinAuth(@GetUser() user: User) {
    return this.authService.createLinkedinOath(user);
  }

  @Get('linkedin/callback')
  linkedinAuthRedirect(
    @Query('code') code: string,
    @Query('state') state: string,
  ) {
    return this.authService.linkedinCallback(code, state);
  }
}
