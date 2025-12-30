import { Controller, Get, Param } from '@nestjs/common';
import { AgentService } from './agent.service';

@Controller('agent')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Get(':id')
  test(@Param('id') id: string) {
    return this.agentService.extractYtTranscript(id);
  }
}
