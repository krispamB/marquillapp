jest.mock(
  '@aws-sdk/client-s3',
  () => ({
    __esModule: true,
    S3Client: jest.fn(),
    PutObjectCommand: jest.fn(),
    DeleteObjectCommand: jest.fn(),
    GetObjectCommand: jest.fn(),
  }),
  { virtual: true },
);

jest.mock(
  '@aws-sdk/s3-request-presigner',
  () => ({
    __esModule: true,
    getSignedUrl: jest.fn(),
  }),
  { virtual: true },
);

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  uploadFile,
  getFile,
  deleteFile,
  getSignedUrl,
  __resetClient,
} from './s3.client';

const ACCOUNT_ID = 'test-account-id';
const BUCKET = 'test-bucket';

const setFullEnv = () => {
  process.env.R2_ACCOUNT_ID = ACCOUNT_ID;
  process.env.R2_BUCKET_NAME = BUCKET;
  process.env.R2_ACCESS_KEY_ID = 'test-access-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
};

const mockSend = jest.fn();
(S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));

describe('S3 client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetClient();
    setFullEnv();
    mockSend.mockResolvedValue({ $metadata: { httpStatusCode: 200 } });
  });

  afterEach(() => {
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_BUCKET_NAME;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
  });

  describe('uploadFile', () => {
    it('should send PutObjectCommand with correct params', async () => {
      const key = 'invoices/file.pdf';
      const body = Buffer.from('pdf-content');
      const mimeType = 'application/pdf';

      await uploadFile(key, body, mimeType);

      expect(PutObjectCommand).toHaveBeenCalledWith({
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentType: mimeType,
      });
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should return the public R2 URL for the uploaded file', async () => {
      const key = 'invoices/file.pdf';
      const url = await uploadFile(key, Buffer.from(''), 'application/pdf');
      expect(url).toBe(
        `https://${BUCKET}.${ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`,
      );
    });

    it('should throw when PutObject returns a non-200 status', async () => {
      mockSend.mockResolvedValueOnce({ $metadata: { httpStatusCode: 403 } });
      await expect(
        uploadFile('key', Buffer.from(''), 'application/pdf'),
      ).rejects.toThrow('R2 upload failed: HTTP 403 for key "key"');
    });

    it('should throw with a clear message when R2_BUCKET_NAME is missing', async () => {
      delete process.env.R2_BUCKET_NAME;
      await expect(
        uploadFile('key', Buffer.from(''), 'text/plain'),
      ).rejects.toThrow(
        'R2 storage is not configured. Missing env vars: R2_BUCKET_NAME',
      );
    });

    it('should throw listing all missing env vars', async () => {
      delete process.env.R2_ACCOUNT_ID;
      delete process.env.R2_ACCESS_KEY_ID;
      await expect(
        uploadFile('key', Buffer.from(''), 'text/plain'),
      ).rejects.toThrow('Missing env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID');
    });

    it('should propagate errors from the S3 send call', async () => {
      mockSend.mockRejectedValueOnce(new Error('upload failed'));
      await expect(
        uploadFile('key', Buffer.from(''), 'text/plain'),
      ).rejects.toThrow('upload failed');
    });
  });

  describe('getFile', () => {
    it('should send GetObjectCommand and return the object body as a Buffer', async () => {
      const key = 'media-uploads/post1/media-1';
      mockSend.mockResolvedValueOnce({
        Body: {
          transformToByteArray: jest
            .fn()
            .mockResolvedValue(new Uint8Array([1, 2, 3])),
        },
      });

      const result = await getFile(key);

      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: BUCKET,
        Key: key,
      });
      expect(result).toEqual(Buffer.from([1, 2, 3]));
    });

    it('should throw when the object has no body', async () => {
      mockSend.mockResolvedValueOnce({ Body: undefined });
      await expect(getFile('some/key')).rejects.toThrow(
        'R2 object "some/key" has no body',
      );
    });

    it('should propagate errors from the S3 send call', async () => {
      mockSend.mockRejectedValueOnce(new Error('get failed'));
      await expect(getFile('some/key')).rejects.toThrow('get failed');
    });
  });

  describe('deleteFile', () => {
    it('should send DeleteObjectCommand with correct params', async () => {
      const key = 'invoices/file.pdf';
      await deleteFile(key);

      expect(DeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: BUCKET,
        Key: key,
      });
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should resolve to undefined on success', async () => {
      await expect(deleteFile('some/key')).resolves.toBeUndefined();
    });

    it('should throw with a clear message when env vars are missing', async () => {
      delete process.env.R2_ACCOUNT_ID;
      await expect(deleteFile('some/key')).rejects.toThrow(
        'R2 storage is not configured. Missing env vars: R2_ACCOUNT_ID',
      );
    });

    it('should propagate errors from the S3 send call', async () => {
      mockSend.mockRejectedValueOnce(new Error('delete failed'));
      await expect(deleteFile('some/key')).rejects.toThrow('delete failed');
    });
  });

  describe('getSignedUrl', () => {
    it('should call awsGetSignedUrl with a GetObjectCommand', async () => {
      (awsGetSignedUrl as jest.Mock).mockResolvedValueOnce(
        'https://signed-url',
      );
      const key = 'invoices/file.pdf';

      await getSignedUrl(key);

      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: BUCKET,
        Key: key,
      });
      expect(awsGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Object),
        { expiresIn: 3600 },
      );
    });

    it('should default expiresIn to 3600 seconds', async () => {
      (awsGetSignedUrl as jest.Mock).mockResolvedValueOnce(
        'https://signed-url',
      );
      await getSignedUrl('some/key');
      expect(awsGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 3600 },
      );
    });

    it('should use a custom expiresIn when provided', async () => {
      (awsGetSignedUrl as jest.Mock).mockResolvedValueOnce(
        'https://signed-url',
      );
      await getSignedUrl('some/key', 900);
      expect(awsGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 900 },
      );
    });

    it('should return the signed URL string', async () => {
      const expected = 'https://presigned.example.com/file?sig=abc';
      (awsGetSignedUrl as jest.Mock).mockResolvedValueOnce(expected);
      const result = await getSignedUrl('some/key');
      expect(result).toBe(expected);
    });

    it('should throw with a clear message when env vars are missing', async () => {
      delete process.env.R2_SECRET_ACCESS_KEY;
      await expect(getSignedUrl('some/key')).rejects.toThrow(
        'R2 storage is not configured. Missing env vars: R2_SECRET_ACCESS_KEY',
      );
    });
  });

  describe('client caching', () => {
    it('should construct S3Client only once across multiple calls', async () => {
      (awsGetSignedUrl as jest.Mock).mockResolvedValue('https://url');
      await uploadFile('a', Buffer.from(''), 'text/plain');
      await uploadFile('b', Buffer.from(''), 'text/plain');
      await deleteFile('c');
      expect(S3Client).toHaveBeenCalledTimes(1);
    });

    it('should reconstruct S3Client after __resetClient', async () => {
      await uploadFile('a', Buffer.from(''), 'text/plain');
      __resetClient();
      await uploadFile('b', Buffer.from(''), 'text/plain');
      expect(S3Client).toHaveBeenCalledTimes(2);
    });
  });
});
