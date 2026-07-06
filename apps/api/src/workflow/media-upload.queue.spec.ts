import { MediaUploadQueue } from './media-upload.queue';
import { MEDIA_UPLOAD_JOB_NAME } from './workflow.constants';

describe('MediaUploadQueue', () => {
  describe('addMediaUploadJob', () => {
    it('should enqueue the job with retry options and a colon-free jobId when called', async () => {
      const service = new MediaUploadQueue({} as any);
      const add = jest.fn().mockResolvedValue(undefined);
      (service as any).queue = { add };

      const data = {
        postId: 'post123',
        connectedAccountId: 'account123',
        ownerUrn: 'urn:li:person:abc',
        items: [
          {
            mediaId: 'media-1',
            r2Key: 'media-uploads/post123/media-1',
            mediaType: 'IMAGE' as const,
          },
        ],
      };

      await service.addMediaUploadJob(data);

      expect(add).toHaveBeenCalledWith(
        MEDIA_UPLOAD_JOB_NAME,
        data,
        expect.objectContaining({
          jobId: 'media-upload-media-1',
          attempts: 3,
          removeOnComplete: true,
          removeOnFail: false,
        }),
      );

      const options = add.mock.calls[0][2];
      expect(options.jobId.includes(':')).toBe(false);
    });
  });
});
