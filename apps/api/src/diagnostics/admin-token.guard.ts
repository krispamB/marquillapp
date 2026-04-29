import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

@Injectable()
export class AdminTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('ADMIN_DIAG_TOKEN');
    if (!expected) {
      throw new UnauthorizedException('Diagnostics disabled');
    }
    const req = context.switchToHttp().getRequest<Request>();
    const provided = req.headers['x-diag-token'];
    if (typeof provided !== 'string' || provided !== expected) {
      throw new UnauthorizedException('Invalid diagnostics token');
    }
    return true;
  }
}
