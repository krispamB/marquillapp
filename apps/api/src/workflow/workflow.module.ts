import { Module } from '@nestjs/common';
import { WorkflowQueue } from './workflow.queue';
import { ScheduleQueue } from './schedule.queue';
import { LinkedinAvatarRefreshQueue } from './linkedin-avatar-refresh.queue';
import { EmailQueue } from './email.queue';
import { MediaUploadQueue } from './media-upload.queue';

// Queue producers only. Run persistence lives in `WorkflowRunModule`: this
// module is imported broadly (the Clerk auth graph pulls it in for EmailQueue),
// and a Mongoose-backed provider here would widen every consumer's graph.
@Module({
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
