import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConnectedAccount, PostDraft } from 'src/database/schemas';
import { EncryptionService } from 'src/encryption/encryption.service';
import { ApiError, apiFetch } from 'src/common/HelperFn/apiFetch.helper';
import { delay } from 'src/common/HelperFn';
import { deleteFile, getFile } from 'src/s3';
import { IVideoInitResponse } from './post.interface';
import {
  MediaUploadJobData,
  MediaUploadJobItem,
} from '../workflow/media-upload.queue';

@Injectable()
export class LinkedinMediaService {
  private readonly logger = new Logger(LinkedinMediaService.name);
  private readonly LINKEDIN_API_BASE = 'https://api.linkedin.com/rest';

  constructor(
    @InjectModel(PostDraft.name)
    private readonly postDraftModel: Model<PostDraft>,
    @InjectModel(ConnectedAccount.name)
    private readonly connectedAccountModel: Model<ConnectedAccount>,
    private readonly encryptionService: EncryptionService,
  ) {}

  async processMediaUpload(data: MediaUploadJobData): Promise<void> {
    const { postId, connectedAccountId, ownerUrn, items } = data;

    const post = await this.postDraftModel.findById(postId);
    if (!post) {
      this.logger.warn(
        `Post ${postId} no longer exists; discarding media upload job`,
      );
      await this.deleteR2Objects(items);
      return;
    }

    const connectedAccount =
      await this.connectedAccountModel.findById(connectedAccountId);
    if (!connectedAccount?.accessToken) {
      throw new Error(
        `Connected account ${connectedAccountId} is missing or has no access token`,
      );
    }

    const accessToken = await this.encryptionService.decrypt(
      connectedAccount.accessToken,
    );

    for (const item of items) {
      const pending = await this.postDraftModel.exists({
        _id: postId,
        'media.id': item.mediaId,
      });
      if (!pending) continue;

      const fileBuffer = await getFile(item.r2Key);
      const urn =
        item.mediaType === 'VIDEO'
          ? await this.uploadVideo(ownerUrn, accessToken, fileBuffer)
          : await this.uploadImage(ownerUrn, accessToken, fileBuffer);

      await this.postDraftModel.updateOne(
        { _id: postId, 'media.id': item.mediaId },
        { $set: { 'media.$.id': urn, 'media.$.status': 'READY' } },
      );

      await deleteFile(item.r2Key).catch((error) =>
        this.logger.warn(
          `Failed to delete R2 object ${item.r2Key}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  }

  async handleMediaUploadFailure(data: MediaUploadJobData): Promise<void> {
    for (const item of data.items) {
      await this.postDraftModel
        .updateOne(
          { _id: data.postId, 'media.id': item.mediaId },
          { $set: { 'media.$.status': 'FAILED' } },
        )
        .catch((error) =>
          this.logger.error(
            `Failed to mark media ${item.mediaId} as FAILED: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    }
    await this.deleteR2Objects(data.items);
  }

  private async deleteR2Objects(items: MediaUploadJobItem[]): Promise<void> {
    await Promise.allSettled(
      items.map((item) =>
        deleteFile(item.r2Key).catch((error) =>
          this.logger.warn(
            `Failed to delete R2 object ${item.r2Key}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        ),
      ),
    );
  }

  async uploadImage(
    ownerUrn: string,
    accessToken: string,
    fileBuffer: Buffer,
  ): Promise<string> {
    interface IResponse {
      value: {
        uploadUrlExpiresAt: number;
        uploadUrl: string;
        image: string;
      };
    }
    try {
      const initializeUploadRequest = await apiFetch<IResponse>(
        `${this.LINKEDIN_API_BASE}/images?action=initializeUpload`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Restli-Protocol-Version': '2.0.0',
            'LinkedIn-Version': '202601',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            initializeUploadRequest: {
              owner: ownerUrn,
            },
          }),
        },
      );

      await apiFetch(initializeUploadRequest.data.value.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'LinkedIn-Version': '202601',
          Authorization: `Bearer ${accessToken}`,
        },
        body: fileBuffer as unknown as BodyInit,
      });

      return initializeUploadRequest.data.value.image;
    } catch (error) {
      const message: unknown =
        error instanceof ApiError
          ? (error.data as { message?: unknown } | undefined)?.message
          : undefined;
      if (
        error instanceof ApiError &&
        error.statusCode === 400 &&
        typeof message === 'string' &&
        message.includes('Organization permissions must be used')
      ) {
        throw new BadRequestException(
          'Your LinkedIn account needs to be reconnected to enable company page posting. Please disconnect and reconnect your LinkedIn account.',
        );
      }
      throw error;
    }
  }

  async uploadVideo(
    ownerUrn: string,
    accessToken: string,
    fileBuffer: Buffer,
  ): Promise<string> {
    const linkedinHeaders = {
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
      'LinkedIn-Version': '202601',
      Authorization: `Bearer ${accessToken}`,
    };

    const initRes = await apiFetch<IVideoInitResponse>(
      `${this.LINKEDIN_API_BASE}/videos?action=initializeUpload`,
      {
        method: 'POST',
        headers: linkedinHeaders,
        body: JSON.stringify({
          initializeUploadRequest: {
            owner: ownerUrn,
            fileSizeBytes: fileBuffer.length,
            uploadCaptions: false,
            uploadThumbnail: false,
          },
        }),
      },
    );

    const {
      video: videoUrn,
      uploadToken,
      uploadInstructions,
    } = initRes.data.value;

    const eTags: string[] = [];
    for (const instruction of uploadInstructions) {
      const chunk = fileBuffer.subarray(
        instruction.firstByte,
        instruction.lastByte + 1,
      );
      const { response } = await apiFetch<void>(instruction.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: chunk as unknown as BodyInit,
      });
      const etag = response.headers.get('etag') ?? response.headers.get('ETag');
      if (!etag) {
        throw new InternalServerErrorException(
          'LinkedIn video chunk upload did not return an ETag',
        );
      }
      eTags.push(etag.replaceAll('"', ''));
    }

    await apiFetch(`${this.LINKEDIN_API_BASE}/videos?action=finalizeUpload`, {
      method: 'POST',
      headers: linkedinHeaders,
      body: JSON.stringify({
        finalizeUploadRequest: {
          video: videoUrn,
          uploadToken,
          uploadedPartIds: eTags,
        },
      }),
    });

    await this.waitForVideoAvailable(videoUrn, accessToken);
    return videoUrn;
  }

  private async waitForVideoAvailable(
    videoUrn: string,
    accessToken: string,
    timeoutMs = 300_000,
  ): Promise<void> {
    const encodedUrn = encodeURIComponent(videoUrn);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await delay(3000);
      const { data } = await apiFetch<{ status: string }>(
        `${this.LINKEDIN_API_BASE}/videos/${encodedUrn}`,
        {
          method: 'GET',
          headers: {
            'X-Restli-Protocol-Version': '2.0.0',
            'LinkedIn-Version': '202601',
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      if (data.status === 'AVAILABLE') return;
      if (data.status === 'PROCESSING_FAILED') {
        throw new InternalServerErrorException(
          'LinkedIn video processing failed',
        );
      }
    }

    throw new InternalServerErrorException(
      'Timed out waiting for LinkedIn video to become available',
    );
  }
}
