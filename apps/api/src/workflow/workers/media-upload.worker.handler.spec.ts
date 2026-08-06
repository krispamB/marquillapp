import {
  handleMediaUploadJobExhausted,
  processMediaUploadJob,
} from './media-upload.worker.handler';

describe('media upload worker handler', () => {
  const job = {
    id: 'job-1',
    data: {
      postId: 'post-1',
      connectedAccountId: 'account-1',
      ownerUrn: 'urn:li:person:1',
      items: [],
    },
  } as any;
  const logger = { log: jest.fn(), error: jest.fn() } as any;

  beforeEach(() => jest.clearAllMocks());

  it('should delegate a queued upload to LinkedinMediaService', async () => {
    const linkedinMedia = {
      processMediaUpload: jest.fn().mockResolvedValue(undefined),
    } as any;

    await processMediaUploadJob(job, logger, linkedinMedia);

    expect(linkedinMedia.processMediaUpload).toHaveBeenCalledWith(job.data);
  });

  it('should mark media failed after the job exhausts retries', async () => {
    const linkedinMedia = {
      handleMediaUploadFailure: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handleMediaUploadJobExhausted(job, logger, linkedinMedia);

    expect(linkedinMedia.handleMediaUploadFailure).toHaveBeenCalledWith(
      job.data,
    );
  });
});
