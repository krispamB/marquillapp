import {
  Controller,
  Get,
  UseGuards,
  Res,
  Post,
  Req,
  Query,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { GetUser } from '../common/decorators';
import { User } from '../database/schemas';
import { JwtAuthGuard } from 'src/common/guards';
import type { IAppResponse } from 'src/common/interfaces';

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
    //attach entire user to cookie
    res.cookie('user', JSON.stringify(user), {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 1 day
    });
    return res.redirect(`${process.env.FRONTEND_URL}/auth/callback`);
  }

  @Post('logout')
  logout(@Res() res: Response): IAppResponse {
    res.clearCookie('access_token');
    return {
      statusCode: HttpStatus.OK,
      message: 'Logged out successfully',
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('linkedin')
  async linkedinAuth(@GetUser() user: User): Promise<IAppResponse> {
    const url = await this.authService.createLinkedinOath(user);
    return {
      statusCode: HttpStatus.OK,
      message: 'Linkedin auth URL generated successfully',
      data: url,
    };
  }

  @Get('linkedin/callback')
  linkedinAuthRedirect(
    @Query('code') code: string,
    @Query('state') state: string,
  ) {
    return this.authService.linkedinCallback(code, state);
  }
  @UseGuards(JwtAuthGuard)
  @Get('connected-accounts')
  async getConnectedAccounts(@GetUser() user: User): Promise<IAppResponse> {
    const accounts = await this.authService.getConnectedAccounts(
      user._id.toString(),
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Connected accounts fetched successfully',
      data: accounts,
    };
  }
}
