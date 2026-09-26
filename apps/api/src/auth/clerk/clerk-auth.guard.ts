import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verifyToken, type VerifyTokenOptions } from '@clerk/backend';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserProvisioningService } from './user-provisioning.service';

/**
 * Strangler guard for the Clerk migration.
 *
 * 1. If a Clerk session token is present (the `__session` cookie, or a Bearer
 *    header as a fallback), verify it networklessly and attach the local Mongo
 *    `User` to the request.
 * 2. Otherwise, delegate to the legacy passport-jwt {@link JwtAuthGuard} so
 *    existing `access_token` cookies keep working until they expire.
 *
 * Once legacy JWT traffic drains, drop the fallback and this becomes a plain
 * Clerk-only guard.
 */
@Injectable()
export class ClerkAuthGuard implements CanActivate {
  private readonly logger = new Logger(ClerkAuthGuard.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly userProvisioning: UserProvisioningService,
    private readonly jwtAuthGuard: JwtAuthGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractClerkToken(request);

    if (!token) {
      return this.legacyFallback(context);
    }

    let claims: Awaited<ReturnType<typeof verifyToken>>;
    try {
      claims = await verifyToken(token, this.verifyOptions());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.debug(`Clerk token verification failed: ${message}`);
      return this.legacyFallback(context);
    }

    const user = await this.userProvisioning.findOrCreate(claims.sub);
    (request as Request & { user: unknown }).user = user;
    return true;
  }

  private async legacyFallback(context: ExecutionContext): Promise<boolean> {
    const result = await this.jwtAuthGuard.canActivate(context);
    return result as boolean;
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
