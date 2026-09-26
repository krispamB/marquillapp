import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verifyToken, type VerifyTokenOptions } from '@clerk/backend';
import type { Request } from 'express';
import { UserProvisioningService } from './user-provisioning.service';

/**
 * Authenticates a request by its Clerk session token (the `__session` cookie,
 * or a Bearer header as a fallback), verified networklessly, and attaches the
 * local Mongo `User` to the request. A missing or invalid token is a 401.
 */
@Injectable()
export class ClerkAuthGuard implements CanActivate {
  private readonly logger = new Logger(ClerkAuthGuard.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly userProvisioning: UserProvisioningService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractClerkToken(request);

    if (!token) {
      throw new UnauthorizedException();
    }

    let claims: Awaited<ReturnType<typeof verifyToken>>;
    try {
      claims = await verifyToken(token, this.verifyOptions());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.debug(`Clerk token verification failed: ${message}`);
      throw new UnauthorizedException();
    }

    const user = await this.userProvisioning.findOrCreate(claims.sub);
    (request as Request & { user: unknown }).user = user;
    return true;
  }

  private extractClerkToken(request: Request): string | null {
    const cookies: unknown = request.cookies;
    if (typeof cookies === 'object' && cookies !== null) {
      const cookieToken = (cookies as Record<string, unknown>).__session;
      if (typeof cookieToken === 'string' && cookieToken) {
        return cookieToken;
      }
    }

    const authHeader = request.headers?.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice('Bearer '.length);
    }

    return null;
  }

  private authorizedParties(): string[] {
    return [
      this.configService.get<string>('FRONTEND_URL'),
      this.configService.get<string>('FRONTEND_URL_DEV'),
    ].filter((value): value is string => Boolean(value));
  }

  /**
   * Verify via the instance's JWKS (fetched + cached by the SDK from
   * `secretKey`) so we never have to hand-manage a PEM. Networkless `jwtKey`
   * is only used when a real PEM public key is actually configured — a
   * placeholder or a value mangled by `.env` newline handling is ignored so it
   * can't cause spurious "JWT signature is invalid" errors.
   */
  private verifyOptions(): VerifyTokenOptions {
    const options: VerifyTokenOptions = {
      secretKey: this.configService.getOrThrow<string>('CLERK_SECRET_KEY'),
      authorizedParties: this.authorizedParties(),
    };

    const jwtKey = this.configService
      .get<string>('CLERK_JWT_KEY')
      ?.replace(/\\n/g, '\n');
    if (jwtKey?.includes('BEGIN PUBLIC KEY')) {
      options.jwtKey = jwtKey;
    }

    return options;
  }
}
