import { Logger } from '@nestjs/common';
import {
  handleMediaUploadJobExhausted,
  processMediaUploadJob,
} from './media-upload.worker.handler';

describe('media-upload worker handler', () => {
  const makeFixtures = () => {
    const logger = {
      log: jest.fn(),
      error: jest.fn(),
    } as unknown as Logger;
    const linkedinMediaService = {
      processMediaUpload: jest.fn().mockResolvedValue(undefined),
      handleMediaUploadFailure: jest.fn().mockResolvedValue(undefined),
    };
    const job = {
      id: 'job-1',
      data: {
        postId: 'post123',
        connectedAccountId: 'account123',
        ownerUrn: 'urn:li:person:abc',
        items: [
          {
            mediaId: 'media-1',
            r2Key: 'media-uploads/post123/media-1',
            mediaType: 'IMAGE',
          },
        ],
      },
    };
    return { logger, linkedinMediaService, job };
  };

  describe('processMediaUploadJob', () => {
    it('should delegate to LinkedinMediaService.processMediaUpload when a job arrives', async () => {
      const { logger, linkedinMediaService, job } = makeFixtures();

      await processMediaUploadJob(
        job as any,
        logger,
        linkedinMediaService as any,
      );

      expect(linkedinMediaService.processMediaUpload).toHaveBeenCalledWith(
        job.data,
      );
    });

    it('should propagate errors when processing fails', async () => {
      const { logger, linkedinMediaService, job } = makeFixtures();
      linkedinMediaService.processMediaUpload.mockRejectedValue(
        new Error('upload failed'),
      );

      await expect(
        processMediaUploadJob(job as any, logger, linkedinMediaService as any),
      ).rejects.toThrow('upload failed');
    });
  });

  describe('handleMediaUploadJobExhausted', () => {
    it('should delegate to LinkedinMediaService.handleMediaUploadFailure when retries are exhausted', async () => {
      const { logger, linkedinMediaService, job } = makeFixtures();

      await handleMediaUploadJobExhausted(
        job as any,
        logger,
        linkedinMediaService as any,
      );

      expect(
        linkedinMediaService.handleMediaUploadFailure,
      ).toHaveBeenCalledWith(job.data);
    });
  });
});
