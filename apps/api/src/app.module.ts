import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { RequestLoggerMiddleware } from './common/middleware';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AgentModule } from './agent/agent.module';
import { LlmModule } from './llm/llm.module';
import { ConfigModule } from '@nestjs/config';
import { ApifyModule } from './apify/apify.module';
import { ActorsModule } from './actors/actors.module';
import { WorkflowModule } from './workflow/workflow.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './users/users.module';
import { PostModule } from './post/post.module';
import { ConfigService } from '@nestjs/config';
import { EncryptionModule } from './encryption/encryption.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { PaymentModule } from './payment/payment.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SubscriptionModule,
    PaymentModule,
    AgentModule,
    LlmModule,
    ApifyModule.register({
      apiKey: process.env.APIFY_API_TOKEN!,
    }),
    ActorsModule,
    WorkflowModule,
    DatabaseModule,
    AuthModule,
    UserModule,
    UserModule,
    PostModule,
    EncryptionModule,
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
