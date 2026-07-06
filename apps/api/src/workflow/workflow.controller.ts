import { Controller, Logger, UseGuards } from '@nestjs/common';
import { WorkflowQueue } from './workflow.queue';
// Direct file import (not the ../auth/clerk barrel) to avoid a require cycle:
// the barrel loads ClerkAuthModule, which imports WorkflowModule.
import { ClerkAuthGuard } from '../auth/clerk/clerk-auth.guard';

@UseGuards(ClerkAuthGuard)
@Controller('workflow')
export class WorkflowController {
  private logger: Logger;
  constructor(private readonly workflowQueue: WorkflowQueue) {
    this.logger = new Logger(WorkflowController.name);
  }
}
