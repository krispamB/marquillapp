import { Global, Module } from '@nestjs/common';
import { AgentRunnerService } from './agent-runner.service';

@Global()
@Module({
  providers: [AgentRunnerService],
  exports: [AgentRunnerService],
})
export class AgentModule {}
