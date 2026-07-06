jest.mock(
  'src/database/schemas',
  () => ({
    ConnectedAccount: { name: 'ConnectedAccount' },
    PostDraft: { name: 'PostDraft' },
  }),
  { virtual: true },
);
jest.mock(
  'src/common/HelperFn/apiFetch.helper',
  () => ({
    apiFetch: jest.fn(),
    ApiError: class ApiError extends Error {
      constructor(
        public statusCode: number,
        public statusText: string,
        public data: any,
      ) {
        super(`HTTP error! status: ${statusCode} ${statusText}`);
      }
    },
  }),
  { virtual: true },
);
jest.mock(
  'src/common/HelperFn',
  () => ({ delay: jest.fn().mockResolvedValue(undefined) }),
  { virtual: true },
);
jest.mock(
  'src/encryption/encryption.service',
  () => ({ EncryptionService: class EncryptionService {} }),
  { virtual: true },
);
jest.mock(
  'src/s3',
  () => ({
    getFile: jest.fn(),
    deleteFile: jest.fn(),
  }),
  { virtual: true },
);

import { Types } from 'mongoose';
import { LinkedinMediaService } from './linkedin-media.service';
import { apiFetch } from 'src/common/HelperFn/apiFetch.helper';
import { deleteFile, getFile } from 'src/s3';

const makeService = () => {
  (deleteFile as jest.Mock).mockResolvedValue(undefined);
  const postDraftModel = {
    findById: jest.fn(),
    exists: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
  };
  const connectedAccountModel = {
    findById: jest.fn(),
  };
  const encryptionService = {
    decrypt: jest.fn().mockResolvedValue('token'),
  };
  const service = new LinkedinMediaService(
    postDraftModel as any,
    connectedAccountModel as any,
    encryptionService as any,
  );

  const postId = new Types.ObjectId().toString();
  const connectedAccountId = new Types.ObjectId().toString();
  const fixtures = {
    jobData: {
      postId,
      connectedAccountId,
      ownerUrn: 'urn:li:person:abc',
      items: [
        {
          mediaId: 'media-1',
          r2Key: `media-uploads/${postId}/media-1`,
          mediaType: 'IMAGE' as const,
        },
      ],
    },
    post: { _id: postId, media: [{ id: 'media-1', status: 'UPLOADING' }] },
    connectedAccount: { accessToken: 'encrypted-token' },
  };

  return {
    service,
    mocks: { postDraftModel, connectedAccountModel, encryptionService },
    fixtures,
  };
};

let service: LinkedinMediaService;
let mocks: ReturnType<typeof makeService>['mocks'];
let fixtures: ReturnType<typeof makeService>['fixtures'];

beforeEach(() => {
  jest.clearAllMocks();
  ({ service, mocks, fixtures } = makeService());
});

describe('LinkedinMediaService', () => {
  describe('processMediaUpload', () => {
    it('should upload pending media, mark it READY, and delete the R2 object when the job runs', async () => {
      mocks.postDraftModel.findById.mockResolvedValue(fixtures.post);
      mocks.connectedAccountModel.findById.mockResolvedValue(
        fixtures.connectedAccount,
      );
      mocks.postDraftModel.exists.mockResolvedValue({ _id: 'x' });
      (getFile as jest.Mock).mockResolvedValue(Buffer.from('image-bytes'));
      const uploadImage = jest
        .spyOn(service, 'uploadImage')
        .mockResolvedValue('urn:li:image:1');

      await service.processMediaUpload(fixtures.jobData);

      expect(getFile).toHaveBeenCalledWith(fixtures.jobData.items[0].r2Key);
      expect(uploadImage).toHaveBeenCalledWith(
        'urn:li:person:abc',
        'token',
        Buffer.from('image-bytes'),
      );
      expect(mocks.postDraftModel.updateOne).toHaveBeenCalledWith(
        { _id: fixtures.jobData.postId, 'media.id': 'media-1' },
        { $set: { 'media.$.id': 'urn:li:image:1', 'media.$.status': 'READY' } },
      );
      expect(deleteFile).toHaveBeenCalledWith(fixtures.jobData.items[0].r2Key);
    });

    it('should use the video upload path when mediaType is VIDEO', async () => {
      fixtures.jobData.items[0].mediaType = 'VIDEO' as any;
      mocks.postDraftModel.findById.mockResolvedValue(fixtures.post);
      mocks.connectedAccountModel.findById.mockResolvedValue(
        fixtures.connectedAccount,
      );
      mocks.postDraftModel.exists.mockResolvedValue({ _id: 'x' });
      (getFile as jest.Mock).mockResolvedValue(Buffer.from('video-bytes'));
      const uploadVideo = jest
        .spyOn(service, 'uploadVideo')
        .mockResolvedValue('urn:li:video:1');

      await service.processMediaUpload(fixtures.jobData);

      expect(uploadVideo).toHaveBeenCalledTimes(1);
      expect(mocks.postDraftModel.updateOne).toHaveBeenCalledWith(
        { _id: fixtures.jobData.postId, 'media.id': 'media-1' },
        { $set: { 'media.$.id': 'urn:li:video:1', 'media.$.status': 'READY' } },
      );
    });

    it('should skip items whose media entry no longer exists when retrying', async () => {
      mocks.postDraftModel.findById.mockResolvedValue(fixtures.post);
      mocks.connectedAccountModel.findById.mockResolvedValue(
        fixtures.connectedAccount,
      );
      mocks.postDraftModel.exists.mockResolvedValue(null);

      await service.processMediaUpload(fixtures.jobData);

      expect(getFile).not.toHaveBeenCalled();
      expect(mocks.postDraftModel.updateOne).not.toHaveBeenCalled();
    });

    it('should discard the job and delete R2 objects when the post is gone', async () => {
      mocks.postDraftModel.findById.mockResolvedValue(null);

      await service.processMediaUpload(fixtures.jobData);

      expect(deleteFile).toHaveBeenCalledWith(fixtures.jobData.items[0].r2Key);
      expect(mocks.connectedAccountModel.findById).not.toHaveBeenCalled();
    });

    it('should throw when the connected account has no access token', async () => {
      mocks.postDraftModel.findById.mockResolvedValue(fixtures.post);
      mocks.connectedAccountModel.findById.mockResolvedValue({
        accessToken: null,
      });

      await expect(
        service.processMediaUpload(fixtures.jobData),
      ).rejects.toThrow('missing or has no access token');
    });
  });

  describe('handleMediaUploadFailure', () => {
    it('should mark items FAILED and delete R2 objects when retries are exhausted', async () => {
      await service.handleMediaUploadFailure(fixtures.jobData);

      expect(mocks.postDraftModel.updateOne).toHaveBeenCalledWith(
        { _id: fixtures.jobData.postId, 'media.id': 'media-1' },
        { $set: { 'media.$.status': 'FAILED' } },
      );
      expect(deleteFile).toHaveBeenCalledWith(fixtures.jobData.items[0].r2Key);
    });
  });

  describe('uploadImage', () => {
    it('should initialize the upload, PUT the buffer, and return the image urn when successful', async () => {
      const mockedApiFetch = apiFetch as jest.Mock;
      mockedApiFetch
        .mockResolvedValueOnce({
          data: {
            value: {
              uploadUrl: 'https://upload.example.com/img',
              image: 'urn:li:image:9',
            },
          },
        })
        .mockResolvedValueOnce({ data: {}, response: {} });

      const fileBuffer = Buffer.from('image-bytes');
      const urn = await service.uploadImage(
        'urn:li:person:abc',
        'token',
        fileBuffer,
      );

      expect(urn).toBe('urn:li:image:9');
      const [putUrl, putOptions] = mockedApiFetch.mock.calls[1];
      expect(putUrl).toBe('https://upload.example.com/img');
      expect(putOptions.method).toBe('PUT');
      expect(putOptions.body).toBe(fileBuffer);
      expect(putOptions.headers.Authorization).toBe('Bearer token');
    });
  });

  describe('uploadVideo', () => {
    const initResponse = {
      data: {
        value: {
          video: 'urn:li:video:1',
          uploadToken: 'upload-token',
          uploadInstructions: [
            { uploadUrl: 'https://u1', firstByte: 0, lastByte: 3 },
            { uploadUrl: 'https://u2', firstByte: 4, lastByte: 7 },
          ],
        },
      },
    };

    it('should upload chunks, strip ETag quotes, finalize, and poll until available when successful', async () => {
      const mockedApiFetch = apiFetch as jest.Mock;
      mockedApiFetch
        .mockResolvedValueOnce(initResponse)
        .mockResolvedValueOnce({
          response: { headers: { get: jest.fn().mockReturnValue('"etag-1"') } },
        })
        .mockResolvedValueOnce({
          response: { headers: { get: jest.fn().mockReturnValue('"etag-2"') } },
        })
        .mockResolvedValueOnce({ data: {}, response: {} })
        .mockResolvedValueOnce({ data: { status: 'AVAILABLE' } });

      const fileBuffer = Buffer.from('abcdefgh');
      const urn = await service.uploadVideo(
        'urn:li:person:abc',
        'token',
        fileBuffer,
      );

      expect(urn).toBe('urn:li:video:1');
      expect(mockedApiFetch.mock.calls[1][1].body).toEqual(Buffer.from('abcd'));
      expect(mockedApiFetch.mock.calls[2][1].body).toEqual(Buffer.from('efgh'));
      const finalizeBody = JSON.parse(mockedApiFetch.mock.calls[3][1].body);
      expect(finalizeBody.finalizeUploadRequest.uploadedPartIds).toEqual([
        'etag-1',
        'etag-2',
      ]);
    });

    it('should throw when a chunk response has no ETag', async () => {
      const mockedApiFetch = apiFetch as jest.Mock;
      mockedApiFetch.mockResolvedValueOnce(initResponse).mockResolvedValueOnce({
        response: { headers: { get: jest.fn().mockReturnValue(null) } },
      });

      await expect(
        service.uploadVideo('urn:li:person:abc', 'token', Buffer.from('abcd')),
      ).rejects.toThrow('did not return an ETag');
    });

    it('should throw when video processing fails', async () => {
      const mockedApiFetch = apiFetch as jest.Mock;
      mockedApiFetch
        .mockResolvedValueOnce({
          data: {
            value: {
              video: 'urn:li:video:1',
              uploadToken: 'upload-token',
              uploadInstructions: [
                { uploadUrl: 'https://u1', firstByte: 0, lastByte: 3 },
              ],
            },
          },
        })
        .mockResolvedValueOnce({
          response: { headers: { get: jest.fn().mockReturnValue('etag-1') } },
        })
        .mockResolvedValueOnce({ data: {}, response: {} })
        .mockResolvedValueOnce({ data: { status: 'PROCESSING_FAILED' } });

      await expect(
        service.uploadVideo('urn:li:person:abc', 'token', Buffer.from('abcd')),
      ).rejects.toThrow('LinkedIn video processing failed');
    });
  });
});
