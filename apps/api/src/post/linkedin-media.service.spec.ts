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
  'src/s3',
  () => ({
    deleteFile: jest.fn().mockResolvedValue(undefined),
    getFile: jest.fn().mockResolvedValue(Buffer.from('media')),
  }),
  { virtual: true },
);
jest.mock(
  'src/database/schemas',
  () => ({
    ConnectedAccount: class ConnectedAccount {},
    Post: class Post {},
    PostMediaStatus: {
      PENDING: 'PENDING',
      UPLOADING: 'UPLOADING',
      READY: 'READY',
      FAILED: 'FAILED',
    },
    PostMediaType: { IMAGE: 'IMAGE', VIDEO: 'VIDEO' },
  }),
  { virtual: true },
);
jest.mock(
  'src/encryption/encryption.service',
  () => ({ EncryptionService: class EncryptionService {} }),
  { virtual: true },
);
import { LinkedinMediaService } from './linkedin-media.service';
import { apiFetch } from 'src/common/HelperFn/apiFetch.helper';
import { deleteFile, getFile } from 'src/s3';

let service: LinkedinMediaService;
let postModel: {
  findById: jest.Mock;
  exists: jest.Mock;
  updateOne: jest.Mock;
};
let connectedAccountModel: { findById: jest.Mock };
let encryptionService: { decrypt: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
  postModel = {
    findById: jest.fn(),
    exists: jest.fn(),
    updateOne: jest.fn().mockResolvedValue(undefined),
  };
  connectedAccountModel = { findById: jest.fn() };
  encryptionService = { decrypt: jest.fn().mockResolvedValue('token') };
  service = new LinkedinMediaService(
    postModel as any,
    connectedAccountModel as any,
    encryptionService as any,
  );
});

describe('LinkedinMediaService', () => {
  describe('processMediaUpload', () => {
    it('should preserve the stable id and store the LinkedIn URN separately', async () => {
      postModel.findById.mockResolvedValue({ _id: 'post-1' });
      postModel.exists.mockResolvedValue(true);
      connectedAccountModel.findById.mockResolvedValue({
        accessToken: 'encrypted',
      });
      jest.spyOn(service, 'uploadImage').mockResolvedValue('urn:li:image:1');

      await service.processMediaUpload({
        postId: 'post-1',
        connectedAccountId: 'account-1',
        ownerUrn: 'urn:li:person:1',
        items: [
          {
            mediaId: 'media-1',
            r2Key: 'media-uploads/post-1/media-1',
            mediaType: 'IMAGE',
          },
        ],
      });

      expect(getFile).toHaveBeenCalledWith('media-uploads/post-1/media-1');
      expect(postModel.updateOne).toHaveBeenCalledWith(
        {
          _id: 'post-1',
          media: { $elemMatch: { id: 'media-1', status: 'UPLOADING' } },
        },
        {
          $set: {
            'media.$.linkedinUrn': 'urn:li:image:1',
            'media.$.status': 'READY',
          },
        },
      );
      expect(deleteFile).toHaveBeenCalledWith('media-uploads/post-1/media-1');
    });
  });

  describe('handleMediaUploadFailure', () => {
    it('should mark uploading entries failed and clean their R2 objects', async () => {
      postModel.updateOne.mockResolvedValue({ matchedCount: 1 });

      await service.handleMediaUploadFailure({
        postId: 'post-1',
        connectedAccountId: 'account-1',
        ownerUrn: 'urn:li:person:1',
        items: [
          {
            mediaId: 'media-1',
            r2Key: 'media-uploads/post-1/media-1',
            mediaType: 'IMAGE',
          },
        ],
      });

      expect(postModel.updateOne).toHaveBeenCalledWith(
        {
          _id: 'post-1',
          media: { $elemMatch: { id: 'media-1', status: 'UPLOADING' } },
        },
        { $set: { 'media.$.status': 'FAILED' } },
      );
      expect(deleteFile).toHaveBeenCalledWith('media-uploads/post-1/media-1');
    });
  });

  describe('getMediaDetails', () => {
    it('should resolve video preview details from LinkedIn', async () => {
      (apiFetch as jest.Mock).mockResolvedValue({
        data: {
          downloadUrl: 'https://media.linkedin.test/video',
          downloadUrlExpiresAt: 1234,
        },
      });

      await expect(
        service.getMediaDetails('VIDEO', 'urn:li:video:1', 'token'),
      ).resolves.toEqual({
        downloadUrl: 'https://media.linkedin.test/video',
        downloadUrlExpiresAt: 1234,
      });
      expect((apiFetch as jest.Mock).mock.calls[0][0]).toContain('/videos/');
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

  describe('uploadDocument', () => {
    it('should PUT the whole document once without finalizing when the upload is initialized', async () => {
      const mockedApiFetch = apiFetch as jest.Mock;
      mockedApiFetch
        .mockResolvedValueOnce({
          data: {
            value: {
              uploadUrl: 'https://upload.example.com/document',
              document: 'urn:li:document:1',
            },
          },
        })
        .mockResolvedValueOnce({ data: {}, response: {} })
        .mockResolvedValueOnce({ data: { status: 'AVAILABLE' } });
      const fileBuffer = Buffer.from('pdf-bytes');

      await expect(
        service.uploadDocument('urn:li:person:abc', 'token', fileBuffer, 12),
      ).resolves.toBe('urn:li:document:1');

      expect(mockedApiFetch).toHaveBeenCalledTimes(3);
      expect(mockedApiFetch.mock.calls[0][0]).toContain(
        '/documents?action=initializeUpload',
      );
      expect(mockedApiFetch.mock.calls[1]).toEqual([
        'https://upload.example.com/document',
        expect.objectContaining({ method: 'PUT', body: fileBuffer }),
      ]);
      expect(
        mockedApiFetch.mock.calls.some(([url]) =>
          String(url).includes('finalizeUpload'),
        ),
      ).toBe(false);
    });

    it('should reject the document before upload when it exceeds 100 MB', async () => {
      const oversized = Buffer.alloc(100 * 1024 * 1024 + 1);

      await expect(
        service.uploadDocument('urn:li:person:abc', 'token', oversized, 1),
      ).rejects.toThrow('100 MB');
      expect(apiFetch).not.toHaveBeenCalled();
    });

    it('should reject the document before upload when it exceeds 300 pages', async () => {
      await expect(
        service.uploadDocument(
          'urn:li:person:abc',
          'token',
          Buffer.from('pdf'),
          301,
        ),
      ).rejects.toThrow('300 pages');
      expect(apiFetch).not.toHaveBeenCalled();
    });
  });
});
