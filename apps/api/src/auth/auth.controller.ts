import {
  Body,
  Controller,
  Delete,
  Get,
  UseGuards,
  Res,
  Post,
  Param,
  Query,
  HttpStatus,
  ConflictException,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { GetUser } from '../common/decorators';
import { User } from '../database/schemas';
import { JwtAuthGuard } from 'src/common/guards';
import type { IAppResponse } from 'src/common/interfaces';
import { ConnectLinkedinOrganizationsDto } from './dto/connect-linkedin-organizations.dto';

@Controller('auth')
export class AuthController {
  private readonly LINKEDIN_CALLBACK_CLOSE_DELAY_SECONDS = 4;

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
  async linkedinAuthRedirect(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    try {
      await this.authService.linkedinCallback(code, state);
      return this.sendLinkedinCallbackHtml(res, {
        statusCode: HttpStatus.OK,
        title: 'LinkedIn Connected',
        message: 'Your LinkedIn account is now connected.',
        variant: 'success',
      });
    } catch (error) {
      const errorCode = this.extractConflictCode(error);
      if (
        errorCode === 'LINKEDIN_ACCOUNT_ALREADY_CONNECTED' ||
        errorCode === 'LINKEDIN_ACCOUNT_MISMATCH'
      ) {
        const message =
          errorCode === 'LINKEDIN_ACCOUNT_ALREADY_CONNECTED'
            ? 'This LinkedIn account is already connected to another user.'
            : 'A different LinkedIn account is already connected to this user.';
        return this.sendLinkedinCallbackHtml(res, {
          statusCode: HttpStatus.CONFLICT,
          title: 'LinkedIn Connection Error',
          message,
          variant: 'error',
        });
      }

      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('linkedin/orgs')
  async getLinkedinOrganizations(@GetUser() user: User): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.OK,
      message: 'LinkedIn organizations fetched successfully',
      data: await this.authService.getLinkedinOrganizations(
        user._id.toString(),
      ),
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('linkedin/orgs')
  async connectLinkedinOrganizations(
    @GetUser() user: User,
    @Body() dto: ConnectLinkedinOrganizationsDto,
  ): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.OK,
      message: 'LinkedIn organizations connected successfully',
      data: await this.authService.connectLinkedinOrganizations(
        user._id.toString(),
        dto.organizationIds,
      ),
    };
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

  @UseGuards(JwtAuthGuard)
  @Delete('connected-accounts/:connectedAccountId')
  async disconnectConnectedAccount(
    @GetUser() user: User,
    @Param('connectedAccountId') connectedAccountId: string,
  ): Promise<IAppResponse> {
    return {
      statusCode: HttpStatus.OK,
      message: 'Connected account disconnected successfully',
      data: await this.authService.disconnectConnectedAccount(
        user._id.toString(),
        connectedAccountId,
      ),
    };
  }

  private sendLinkedinCallbackHtml(
    res: Response,
    params: {
      statusCode: number;
      title: string;
      message: string;
      variant: 'success' | 'error';
    },
  ) {
    return res
      .status(params.statusCode)
      .type('html')
      .send(this.renderLinkedinCallbackHtml(params));
  }

  private renderLinkedinCallbackHtml(params: {
    title: string;
    message: string;
    variant: 'success' | 'error';
  }) {
    const accentColor = params.variant === 'success' ? '#0f766e' : '#b91c1c';
    const borderColor = params.variant === 'success' ? '#99f6e4' : '#fecaca';
    const background = params.variant === 'success' ? '#f0fdfa' : '#fef2f2';

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${params.title}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f8fafc;
      color: #0f172a;
    }
    main {
      width: 100%;
      max-width: 440px;
      background: ${background};
      border: 1px solid ${borderColor};
      border-radius: 12px;
      padding: 20px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 20px;
      line-height: 1.3;
      color: ${accentColor};
    }
    p { margin: 0 0 8px; font-size: 15px; line-height: 1.5; }
    small { color: #475569; display: block; margin-bottom: 14px; }
    button {
      border: 0;
      border-radius: 8px;
      padding: 10px 14px;
      background: ${accentColor};
      color: #ffffff;
      font-size: 14px;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <main>
    <h1>${params.title}</h1>
    <p>${params.message}</p>
    <small id="close-status">Closing in ${this.LINKEDIN_CALLBACK_CLOSE_DELAY_SECONDS}s...</small>
    <button type="button" onclick="window.close()">Close window</button>
  </main>
  <script>
    (function () {
      var statusEl = document.getElementById('close-status');
      var delaySeconds = ${this.LINKEDIN_CALLBACK_CLOSE_DELAY_SECONDS};
      var hasPopupOpener = !!window.opener && !window.opener.closed;
      var hasShortHistory = window.history.length <= 2;
      var shouldAutoClose = hasPopupOpener || hasShortHistory;

      function updateStatus(text) {
        if (statusEl) statusEl.textContent = text;
      }

      if (!shouldAutoClose) {
        updateStatus('You can close this tab manually.');
        return;
      }

      updateStatus('Closing in ' + delaySeconds + 's...');
      var timer = window.setInterval(function () {
        delaySeconds -= 1;
        if (delaySeconds > 0) {
          updateStatus('Closing in ' + delaySeconds + 's...');
          return;
        }

        window.clearInterval(timer);
        updateStatus('Closing...');
        window.close();

        window.setTimeout(function () {
          updateStatus('You can close this tab manually.');
        }, 500);
      }, 1000);
    })();
  </script>
</body>
</html>`;
  }

  private extractConflictCode(error: unknown): string | null {
    if (!(error instanceof ConflictException)) {
      return null;
    }

    const response = error.getResponse();
    if (typeof response === 'object' && response !== null && 'code' in response) {
      return String((response as { code?: unknown }).code ?? '');
    }

    return null;
  }
}
