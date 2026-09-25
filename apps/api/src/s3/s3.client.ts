import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';

const R2_ENV_KEYS = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
] as const;

let _client: S3Client | null = null;

function getClient(): { client: S3Client; bucket: string } {
  const missing = R2_ENV_KEYS.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `R2 storage is not configured. Missing env vars: ${missing.join(', ')}`,
    );
  }

  if (!_client) {
    _client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }

  return { client: _client, bucket: process.env.R2_BUCKET_NAME! };
}

export const __resetClient = () => {
  _client = null;
};

export async function uploadFile(
  key: string,
  body: Buffer,
  mimeType: string,
): Promise<string> {
  const { client, bucket } = getClient();
  const response = await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: mimeType,
    }),
  );

  if (response.$metadata.httpStatusCode !== 200) {
    throw new Error(
      `R2 upload failed: HTTP ${response.$metadata.httpStatusCode} for key "${key}"`,
    );
  }

  return `https://${bucket}.${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`;
}

export async function getFile(key: string): Promise<Buffer> {
  const { client, bucket } = getClient();
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );

  if (!response.Body) {
    throw new Error(`R2 object "${key}" has no body`);
  }

  return Buffer.from(await response.Body.transformToByteArray());
}

export async function deleteFile(key: string): Promise<void> {
  const { client, bucket } = getClient();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function getSignedUrl(
  key: string,
  expiresIn = 3600,
): Promise<string> {
  const { client, bucket } = getClient();
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return awsGetSignedUrl(client, command, { expiresIn });
}

export async function getSignedUploadUrl(
  key: string,
  mimeType: string,
  sizeBytes: number,
  expiresIn = 1800,
): Promise<string> {
  const { client, bucket } = getClient();
  // ContentType/ContentLength become signed headers, so R2 rejects a PUT
  // whose actual type or size differ from what was declared here.
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: mimeType,
    ContentLength: sizeBytes,
  });
  return awsGetSignedUrl(client, command, { expiresIn });
}

export async function headFile(
  key: string,
): Promise<{ sizeBytes: number; mimeType?: string } | null> {
  const { client, bucket } = getClient();
  try {
    const response = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    return {
      sizeBytes: response.ContentLength ?? 0,
      mimeType: response.ContentType,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'NotFound' || error.name === 'NoSuchKey')
    ) {
      return null;
    }
    throw error;
  }
}
