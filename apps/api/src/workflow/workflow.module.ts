import { Module } from '@nestjs/common';
import { WorkflowController } from './workflow.controller';
import { WorkflowQueue } from './workflow.queue';
import { ScheduleQueue } from './schedule.queue';
import { LinkedinAvatarRefreshQueue } from './linkedin-avatar-refresh.queue';
import { EmailQueue } from './email.queue';
import { MediaUploadQueue } from './media-upload.queue';

@Module({
  controllers: [WorkflowController],
  providers: [
    WorkflowQueue,
    ScheduleQueue,
    LinkedinAvatarRefreshQueue,
    EmailQueue,
    MediaUploadQueue,
  ],
  exports: [
    WorkflowQueue,
    ScheduleQueue,
    LinkedinAvatarRefreshQueue,
    EmailQueue,
    MediaUploadQueue,
  ],
})
export class WorkflowModule {}
