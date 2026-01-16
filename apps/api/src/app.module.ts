import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AgentModule } from './agent/agent.module';
import { LlmModule } from './llm/llm.module';
import { ConfigModule } from '@nestjs/config';
import { ApifyModule } from './apify/apify.module';
import { ActorsModule } from './actors/actors.module';
import { WorkflowModule } from './workflow/workflow.module';
import { DatabaseModule } from './database/database.module';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AgentModule,
    LlmModule,
    ApifyModule.register({
      apiKey: process.env.APIFY_API_TOKEN!,
    }),
    ActorsModule,
    WorkflowModule,
    DatabaseModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
