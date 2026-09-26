import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WorkflowModule } from '../../workflow/workflow.module';
import { clerkClientProvider } from './clerk.client';
import { UserProvisioningService } from './user-provisioning.service';
import { ClerkAuthGuard } from './clerk-auth.guard';

/**
 * Provides the Clerk guard and its dependencies app-wide so any controller can
 * use `@UseGuards(ClerkAuthGuard)` without re-wiring providers per module.
 */
@Global()
@Module({
  imports: [ConfigModule, WorkflowModule],
  providers: [clerkClientProvider, UserProvisioningService, ClerkAuthGuard],
  exports: [ClerkAuthGuard, UserProvisioningService],
})
export class ClerkAuthModule {}
