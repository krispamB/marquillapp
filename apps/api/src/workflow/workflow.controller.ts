import { Controller, Logger, UseGuards } from '@nestjs/common';
import { WorkflowQueue } from './workflow.queue';
import { JwtAuthGuard } from '../common/guards';

@UseGuards(JwtAuthGuard)
@Controller('workflow')
export class WorkflowController {
  private logger: Logger;
  constructor(private readonly workflowQueue: WorkflowQueue) {
    this.logger = new Logger(WorkflowController.name);
  }
}
