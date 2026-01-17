import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { WorkflowQueue } from './workflow.queue';
import { WorkflowStep } from './workflow.constants';
import { InputDto } from '../agent/dto';
import { AgentService } from '../agent/agent.service';
import { JwtAuthGuard } from '../common/guards';

@UseGuards(JwtAuthGuard)
@Controller('workflow')
export class WorkflowController {
  private logger: Logger;
  constructor(
    private readonly workflowQueue: WorkflowQueue,
    private agentService: AgentService,
  ) {
    this.logger = new Logger(WorkflowController.name);
  }

  @Post()
  async startWorkflow(@Body() dto: InputDto) {
    const workflowId = `workflow_${Date.now()}`;
    const userIntent = await this.agentService.generateUserIntent(dto.input);
    await this.workflowQueue.addWorkflowJob(workflowId, {
      steps: [
        WorkflowStep.GET_QUERIES,
        WorkflowStep.RUN_RESEARCH,
        WorkflowStep.CREATE_DRAFT,
      ],
      input: userIntent,
    });

    return {
      message: `Workflow started successfully.`,
      workflowId,
    };
  }

  @Get(':id/status')
  async getStatus(@Param('id') id: string) {
    const job = await this.workflowQueue.queue.getJob(id);
    if (!job) return { status: 'not found' };
    const [state] = await Promise.all([job.getState()]);
    return { state, progress: job.progress };
  }
}
