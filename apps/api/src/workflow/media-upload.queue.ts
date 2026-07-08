import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import {
  MEDIA_UPLOAD_JOB_NAME,
  MEDIA_UPLOAD_QUEUE_NAME,
} from './workflow.constants';

export interface MediaUploadJobItem {
  mediaId: string;
  r2Key: string;
  mediaType: 'IMAGE' | 'VIDEO';
}

export interface MediaUploadJobData {
  postId: string;
  connectedAccountId: string;
  ownerUrn: string;
  items: MediaUploadJobItem[];
}

@Injectable()
export class MediaUploadQueue implements OnModuleInit, OnModuleDestroy {
  public queue: Queue;

  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.queue = new Queue(MEDIA_UPLOAD_QUEUE_NAME, {
      connection: {
        url: this.config.get<string>('REDIS_URL')!,
      },
    });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }

  async addMediaUploadJob(data: MediaUploadJobData) {
    await this.queue.add(MEDIA_UPLOAD_JOB_NAME, data, {
      jobId: `media-upload-${data.items[0].mediaId}`,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 10_000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    });
  }
}
