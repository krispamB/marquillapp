import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { RequestLoggerMiddleware } from './common/middleware';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, minutes } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { RedisModule } from './redis/redis.module';
import { RedisService } from './redis/redis.service';
import { WorkflowModule } from './workflow/workflow.module';
import { WorkflowRunModule } from './workflow/workflow-run.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { ClerkAuthModule } from './auth/clerk';
import { UserModule } from './users/users.module';
import { PostModule } from './post/post.module';
import { EncryptionModule } from './encryption/encryption.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { PaymentModule } from './payment/payment.module';
import { TierModule } from './tier/tier.module';
import { MailModule } from './mail';
import { FeedbackModule } from './feedback/feedback.module';
import { OnboardingModule } from './onboarding';
import { DiagnosticsModule } from './diagnostics/diagnostics.module';
import { ArtifactModule } from './artifact';
import { CarouselModule } from './carousel';
import { DesignSystemModule } from './design-system';

// The HTTP server's root. The LLM stack (`LlmModule`, `AgentModule`) and its
// scraping siblings (`ApifyModule`, `ActorsModule`) live in `WorkerModule`
// instead: nothing on the HTTP surface injects them, and `@openrouter/sdk`
// alone retains ~129MB of zod schemas per process. `WorkerModule` imports this
// module, so anything added here is still paid for twice.
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Counters live in Redis so limits hold across API replicas and restarts.
    // Applied per route by `UserThrottlerGuard`; routes may tighten the
    // default with `@Throttle`.
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [{ ttl: minutes(1), limit: 120 }],
        storage: new ThrottlerStorageRedisService(redis.getClient()),
      }),
    }),
    SubscriptionModule,
    TierModule,
    FeedbackModule,
    PaymentModule,
    MailModule,
    WorkflowModule,
    WorkflowRunModule,
    DatabaseModule,
    AuthModule,
    ClerkAuthModule,
    UserModule,
    PostModule,
    EncryptionModule,
    OnboardingModule,
    DiagnosticsModule,
    ArtifactModule,
    CarouselModule,
    DesignSystemModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestLoggerMiddleware)
      .forRoutes({ path: '*v1', method: RequestMethod.ALL });
  }
}
