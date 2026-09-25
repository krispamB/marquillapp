import { Module } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { AgentModule } from '../../agent/agent.module';
import { LlmModule } from '../../llm/llm.module';
import { ApifyModule } from '../../apify/apify.module';
import { ActorsModule } from '../../actors/actors.module';

/**
 * The background worker's root, and the only process that boots the LLM stack.
 *
 * `AppModule` carries everything both processes share; these four are added on
 * top because `AgentRunnerService` is resolved here and nowhere else. Keeping
 * them out of `AppModule` spares the API server ~138MB of resident memory it
 * was paying for without ever making a completion call.
 *
 * `ActorsModule` and `ApifyModule` come along not because the worker uses them
 * — nothing injects `ActorsService` — but because `ActorsService` depends on
 * `ResponseParserService` from `LlmModule`, so the two must move together or
 * the server fails DI resolution at boot.
 */
@Module({
  imports: [
    AppModule,
    LlmModule,
    AgentModule,
    ApifyModule.register({
      apiKey: process.env.APIFY_API_TOKEN!,
    }),
    ActorsModule,
  ],
})
export class WorkerModule {}
