import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { LinkedinMediaService } from '../../post/linkedin-media.service';
import { MediaUploadJobData } from '../media-upload.queue';

export async function processMediaUploadJob(
  job: Job<MediaUploadJobData>,
  logger: Logger,
  linkedinMediaService: LinkedinMediaService,
): Promise<void> {
  logger.log(
    `Processing media upload job ${job.id} for post ${job.data.postId}`,
  );
  await linkedinMediaService.processMediaUpload(job.data);
}

export async function handleMediaUploadJobExhausted(
  job: Job<MediaUploadJobData>,
  logger: Logger,
  linkedinMediaService: LinkedinMediaService,
): Promise<void> {
  logger.error(
    `Media upload job ${job.id} exhausted all retries for post ${job.data.postId}`,
  );
  await linkedinMediaService.handleMediaUploadFailure(job.data);
}
