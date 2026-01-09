import { Global, Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { HttpModule } from '@nestjs/axios';
import { AgentController } from './agent.controller';

@Global()
@Module({
  imports: [HttpModule],
  providers: [AgentService],
  controllers: [AgentController],
  exports: [AgentService],
})
export class AgentModule {}
