import { Module } from '@nestjs/common';
import { WorkflowController } from './workflow.controller';
import { WorkflowQueue } from './workflow.queue';
import { ScheduleQueue } from './schedule.queue';
import { LinkedinAvatarRefreshQueue } from './linkedin-avatar-refresh.queue';

@Module({
  controllers: [WorkflowController],
  providers: [WorkflowQueue, ScheduleQueue, LinkedinAvatarRefreshQueue],
  exports: [WorkflowQueue, ScheduleQueue, LinkedinAvatarRefreshQueue],
})
export class WorkflowModule {}
