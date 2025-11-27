import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { WorkflowQueue } from './workflow.queue';
import { WORKFLOW_STEPS } from './workflow.constants';
import { InputDto } from '../agent/dto';

@Controller('workflow')
export class WorkflowController {
  constructor(private readonly workflowQueue: WorkflowQueue) {}

  @Post()
  async startWorkflow(@Body() dto: InputDto) {
    const workflowId = `workflow_${Date.now()}`;
    await this.workflowQueue.addWorkflowJob(workflowId, {
      steps: [
        WORKFLOW_STEPS.GET_QUERIES,
        WORKFLOW_STEPS.RUN_RESEARCH,
        WORKFLOW_STEPS.CREATE_DRAFT,
      ],
      input: dto.input,
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
