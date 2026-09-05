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

// The HTTP server's root. The LLM stack (`LlmModule`, `AgentModule`) and its
// scraping siblings (`ApifyModule`, `ActorsModule`) live in `WorkerModule`
// instead: nothing on the HTTP surface injects them, and `@openrouter/sdk`
// alone retains ~129MB of zod schemas per process. `WorkerModule` imports this
// module, so anything added here is still paid for twice.
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
