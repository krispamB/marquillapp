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
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';
import { randomBytes } from 'crypto';
import { AuthService } from './auth.service';
import { GetUser } from '../common/decorators';
import { User } from '../database/schemas';
import { ClerkAuthGuard } from './clerk';
import type { IAppResponse } from 'src/common/interfaces';
import { ConnectLinkedinOrganizationsDto } from './dto/connect-linkedin-organizations.dto';
import { UserThrottlerGuard } from '../common/guards/user-throttler.guard';
import { Throttle, minutes } from '@nestjs/throttler';

@Controller('auth')
export class AuthController {
  private readonly LINKEDIN_CALLBACK_CLOSE_DELAY_SECONDS = 4;

  constructor(private readonly authService: AuthService) {}

  // Each call writes an OAuth state nonce to Redis.
  @Throttle({ default: { limit: 10, ttl: minutes(1) } })
  @UseGuards(ClerkAuthGuard, UserThrottlerGuard)
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
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Res() res: Response,
  ) {
    try {
      await this.authService.linkedinCallback(code, state);
      return this.sendLinkedinCallbackHtml(res, {
        statusCode: HttpStatus.OK,
        title: 'LinkedIn connected',
        message: 'Your LinkedIn account is now connected.',
        variant: 'success',
      });
    } catch (error) {
      const errorCode = this.extractErrorCode(error);
      if (
        errorCode === 'LINKEDIN_OAUTH_STATE_INVALID' ||
        errorCode === 'LINKEDIN_AUTHORIZATION_INCOMPLETE'
      ) {
        const message =
          errorCode === 'LINKEDIN_OAUTH_STATE_INVALID'
            ? 'This connection link is invalid or has expired. Start again from Marquill.'
            : 'LinkedIn authorization was not completed. Start again from Marquill.';
        return this.sendLinkedinCallbackHtml(res, {
          statusCode: HttpStatus.BAD_REQUEST,
          title: "LinkedIn couldn't connect",
          message,
          variant: 'error',
        });
      }
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
          title: "LinkedIn couldn't connect",
          message,
          variant: 'error',
        });
      }

      throw error;
    }
  }

  @UseGuards(ClerkAuthGuard, UserThrottlerGuard)
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

  @UseGuards(ClerkAuthGuard, UserThrottlerGuard)
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

  @UseGuards(ClerkAuthGuard, UserThrottlerGuard)
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

  @UseGuards(ClerkAuthGuard, UserThrottlerGuard)
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
    const nonce = randomBytes(16).toString('base64');
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    );
    return res
      .status(params.statusCode)
      .type('html')
      .send(this.renderLinkedinCallbackHtml({ ...params, nonce }));
  }

  private renderLinkedinCallbackHtml(params: {
    title: string;
    message: string;
    variant: 'success' | 'error';
    nonce: string;
  }) {
    // Mirrors the web app's workspace tokens: warm canvas, hairline borders,
    // ink-first controls, colour only on the status dot.
    const statusColor = params.variant === 'success' ? '#1f9d55' : '#c2410c';
    const statusLabel =
      params.variant === 'success' ? 'Connected' : 'Not connected';

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${params.title} · Marquill</title>
  <style>
    :root {
      --canvas: #f6f6f4;
      --surface: #ffffff;
      --ink-900: #0a0a0a;
      --ink-700: #3a3a38;
      --ink-500: #76766f;
      --line: #e7e7e3;
      --button-bg: #0a0a0a;
      --button-fg: #ffffff;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --canvas: #0c0c0b;
        --surface: #161614;
        --ink-900: #f4f4f1;
        --ink-700: #c6c6bf;
        --ink-500: #8f8f88;
        --line: #262624;
        --button-bg: #f4f4f1;
        --button-fg: #0a0a0a;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 16px;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--canvas);
      color: var(--ink-900);
      -webkit-font-smoothing: antialiased;
    }
    .wrap { width: 100%; max-width: 400px; }
    .wordmark {
      display: block;
      margin: 0 0 16px 4px;
      font-family: "Courier Prime", "Courier New", Courier, monospace;
      font-size: 18px;
      font-weight: 700;
      color: var(--ink-900);
    }
    main {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 24px;
    }
    .status {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0 0 12px;
      font-size: 12px;
      font-weight: 600;
      color: ${statusColor};
    }
    .status::before {
      content: "";
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: ${statusColor};
    }
    h1 {
      margin: 0 0 6px;
      font-size: 18px;
      font-weight: 600;
      line-height: 1.3;
      letter-spacing: -0.01em;
    }
    p { margin: 0; font-size: 14px; line-height: 1.55; color: var(--ink-700); }
    .footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 20px;
    }
    small { font-size: 12px; color: var(--ink-500); }
    button {
      flex-shrink: 0;
      border: 0;
      border-radius: 10px;
      padding: 9px 14px;
      background: var(--button-bg);
      color: var(--button-fg);
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    button:focus-visible { outline: 2px solid #2a6fdb; outline-offset: 2px; }
  </style>
</head>
<body>
  <div class="wrap">
    <span class="wordmark" aria-label="Marquill">marquill_</span>
    <main>
      <div class="status">${statusLabel}</div>
      <h1>${params.title}</h1>
      <p>${params.message}</p>
      <div class="footer">
        <small id="close-status">Closing in ${this.LINKEDIN_CALLBACK_CLOSE_DELAY_SECONDS}s...</small>
        <button type="button" id="close-window">Close window</button>
      </div>
    </main>
  </div>
  <script nonce="${params.nonce}">
    (function () {
      document.getElementById('close-window').addEventListener('click', function () {
        window.close();
      });
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

  private extractErrorCode(error: unknown): string | null {
    if (!(error instanceof HttpException)) {
      return null;
    }

    const response = error.getResponse();
    if (
      typeof response === 'object' &&
      response !== null &&
      'code' in response
    ) {
      return String((response as { code?: unknown }).code ?? '');
    }

    return null;
  }
}
