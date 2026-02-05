import { Module } from '@nestjs/common';
import { WorkflowController } from './workflow.controller';
import { WorkflowQueue } from './workflow.queue';
import { ScheduleQueue } from './schedule.queue';

@Module({
  controllers: [WorkflowController],
  providers: [WorkflowQueue, ScheduleQueue],
  exports: [WorkflowQueue, ScheduleQueue],
})
export class WorkflowModule {}
