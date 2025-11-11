import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AgentModule } from './agent/agent.module';
import { LlmModule } from './llm/llm.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), AgentModule, LlmModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
