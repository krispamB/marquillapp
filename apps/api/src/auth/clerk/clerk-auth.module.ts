import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WorkflowModule } from '../../workflow/workflow.module';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { clerkClientProvider } from './clerk.client';
import { UserProvisioningService } from './user-provisioning.service';
import { ClerkAuthGuard } from './clerk-auth.guard';

/**
 * Provides the Clerk strangler guard and its dependencies app-wide so any
 * controller can swap `@UseGuards(JwtAuthGuard)` for `@UseGuards(ClerkAuthGuard)`
 * without re-wiring providers per module.
 *
 * `JwtAuthGuard` is provided here so it can be injected into `ClerkAuthGuard`
 * for the legacy fallback. The passport `jwt` strategy itself is still
 * registered by `AuthModule` (via `JwtStrategy`).
 */
@Global()
@Module({
  imports: [ConfigModule, WorkflowModule],
  providers: [
    clerkClientProvider,
    UserProvisioningService,
    JwtAuthGuard,
    ClerkAuthGuard,
  ],
  exports: [ClerkAuthGuard, UserProvisioningService, JwtAuthGuard],
})
export class ClerkAuthModule {}
