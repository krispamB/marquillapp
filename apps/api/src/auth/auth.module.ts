import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { EncryptionModule } from '../encryption/encryption.module';
import { FeatureGatingModule } from '../feature-gating';
import { RedisModule } from '../redis/redis.module';
import { WorkflowModule } from '../workflow/workflow.module';

@Module({
  imports: [EncryptionModule, FeatureGatingModule, RedisModule, WorkflowModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
