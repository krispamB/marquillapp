import { Module } from '@nestjs/common';
import { WorkflowController } from './workflow.controller';
import { WorkflowQueue } from './workflow.queue';
import { ScheduleQueue } from './schedule.queue';
import { LinkedinAvatarRefreshQueue } from './linkedin-avatar-refresh.queue';
import { EmailQueue } from './email.queue';

@Module({
  controllers: [WorkflowController],
  providers: [WorkflowQueue, ScheduleQueue, LinkedinAvatarRefreshQueue, EmailQueue],
  exports: [WorkflowQueue, ScheduleQueue, LinkedinAvatarRefreshQueue, EmailQueue],
})
export class WorkflowModule {}
