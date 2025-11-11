import { Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { HttpModule } from '@nestjs/axios';
import { AgentController } from './agent.controller';

@Module({
  imports: [HttpModule],
  providers: [AgentService],
  controllers: [AgentController],
})
export class AgentModule {}
