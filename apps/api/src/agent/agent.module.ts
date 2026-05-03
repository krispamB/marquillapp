import { Global, Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { AgentController } from './agent.controller';

@Global()
@Module({
  providers: [AgentService],
  controllers: [AgentController],
  exports: [AgentService],
})
export class AgentModule {}
