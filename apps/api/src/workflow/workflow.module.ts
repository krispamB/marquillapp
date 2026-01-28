import { Module } from '@nestjs/common';
import { WorkflowController } from './workflow.controller';
import { WorkflowQueue } from './workflow.queue';

@Module({
  controllers: [WorkflowController],
  providers: [WorkflowQueue],
  exports: [WorkflowQueue],
})
export class WorkflowModule {}
