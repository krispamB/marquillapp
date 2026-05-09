import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { WorkflowQueue } from '../workflow/workflow.queue';
import { ScheduleQueue } from '../workflow/schedule.queue';
import { InputDto } from '../agent/dto';
import { UpdatePostDto, SchedulePostDto } from './dto';
import {
  AccountProvider,
  ConnectedAccount,
  LinkedinAccountType,
  PostDraft,
  PostDraftStatus,
  User,
} from 'src/database/schemas';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ApiError, apiFetch } from 'src/common/HelperFn/apiFetch.helper';
import { EncryptionService } from 'src/encryption/encryption.service';
import { IContent, ILinkedInPost, IVideoInitResponse } from './post.interface';
import { delay, formatLinkedinContent } from 'src/common/HelperFn';
import { FeatureGatingService } from '../feature-gating/feature-gating.service';
import { createReadStream } from 'fs';
import { unlink } from 'fs/promises';
import { Readable } from 'stream';

interface PostFilters {
  availableMonths: string[];
  connectedAccountIds: string[];
}

export interface GetPostsResult {
  data: PostDraft[];
  filters: PostFilters;
}

@Injectable()
export class PostService {
  private readonly logger = new Logger(PostService.name);
  private readonly LINKEDIN_API_BASE = 'https://api.linkedin.com/rest';

  constructor(
    private readonly workflowQueue: WorkflowQueue,
    private readonly scheduleQueue: ScheduleQueue,
    @InjectModel(PostDraft.name)
    private readonly postDraftModel: Model<PostDraft>,
    @InjectModel(ConnectedAccount.name)
    private readonly connectedAccountModel: Model<ConnectedAccount>,
    private readonly encryptionService: EncryptionService,
    private readonly featureGatingService: FeatureGatingService,
  ) {}

  async createDraft(user: User, accountId: string, dto: InputDto) {
    await this.featureGatingService.assertAiDraftQuota(user._id.toString());
    await this.getOwnedLinkedinConnectedAccount(user._id.toString(), accountId);

    const draft = new this.postDraftModel({
      user,
      connectedAccount: new Types.ObjectId(accountId),
      type: dto.contentType,
      stylePreset: dto.stylePreset,
      status: PostDraftStatus.DRAFT,
    });

    await draft.save();

    const workflowId = draft._id.toString();
    await this.workflowQueue.addWorkflowJob(workflowId, {
      workflowName: dto.contentType,
      input: dto,
    });
    await this.featureGatingService.incrementAiDraftUsage(user._id.toString());

    return workflowId;
  }

  async getStatus(id: string) {
    const job = await this.workflowQueue.queue.getJob(id);
    if (!job) return { status: 'not found' };
    const [state] = await Promise.all([job.getState()]);
    return { state, progress: job.progress };
  }

  async getPosts(
    user: User,
    accountConnected?: string,
    status?: string,
    month?: string,
  ): Promise<GetPostsResult> {
    const filter: any = { user: user._id };

    if (accountConnected) {
      filter.connectedAccount = new Types.ObjectId(accountConnected);
    }

    if (status) {
      filter.status = status;
    }

    if (month) {
      const [year, monthNum] = month.split('-').map(Number);
      if (!isNaN(year) && !isNaN(monthNum)) {
        const start = new Date(year, monthNum - 1, 1);
        const end = new Date(year, monthNum, 1);
        filter.updatedAt = { $gte: start, $lt: end };
      }
    }

    const postsQuery = this.postDraftModel
      .find(filter)
      .select('-userIntent -compressionResult -youtubeResearch')
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    const availableMonthsQuery = this.postDraftModel.aggregate<{
      month: string;
    }>([
      {
        $match: {
          user: user._id,
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m',
              date: '$createdAt',
            },
          },
        },
      },
      {
        $sort: { _id: -1 },
      },
      {
        $project: {
          _id: 0,
          month: '$_id',
        },
      },
    ]);

    const connectedAccountIdsQuery = this.postDraftModel.distinct(
      'connectedAccount',
      { user: user._id },
    );

    const [posts, availableMonthsResult, connectedAccountIds] =
      await Promise.all([
        postsQuery,
        availableMonthsQuery,
        connectedAccountIdsQuery,
      ]);

    return {
      data: posts,
      filters: {
        availableMonths: availableMonthsResult.map((item) => item.month),
        connectedAccountIds: connectedAccountIds.map((id) => id.toString()),
      },
    };
  }

  async updateContent(user: User, postId: string, dto: UpdatePostDto) {
    const post = await this.postDraftModel.findById(postId);
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (post.user.toString() !== user._id.toString()) {
      throw new ForbiddenException('You are not authorized to edit this post');
    }

    post.content = dto.content;
    return post.save();
  }

  async deletePost(user: User, postId: string) {
    const post = await this.postDraftModel.findById(postId);
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (post.user.toString() !== user._id.toString()) {
      throw new ForbiddenException(
        'You are not authorized to delete this post',
      );
    }

    const connectedAccount = await this.getOwnedLinkedinConnectedAccount(
      user._id.toString(),
      post.connectedAccount.toString(),
    );
    const canUseLinkedinAccount = this.isLinkedinAccountUsable(connectedAccount);
    if (post.status === PostDraftStatus.PUBLISHED && !canUseLinkedinAccount) {
      throw new ConflictException(
        'Reconnect account to delete published posts from LinkedIn safely.',
      );
    }

    if (post.status === PostDraftStatus.SCHEDULED) {
      const scheduledJob = await this.scheduleQueue.queue.getJob(
        post._id.toString(),
      );
      if (scheduledJob) {
        await scheduledJob.remove();
      }
    }

    if (post.status === PostDraftStatus.PUBLISHED && post.channelPostId) {
      const accessToken = await this.encryptionService.decrypt(
        connectedAccount.accessToken!,
      );
      const externalUrl = `${this.LINKEDIN_API_BASE}/posts/${encodeURIComponent(post.channelPostId)}`;
      await apiFetch(externalUrl, {
        method: 'DELETE',
        headers: {
          'X-Restli-Protocol-Version': '2.0.0',
          'LinkedIn-Version': '202601',
          Authorization: `Bearer ${accessToken}`,
        },
      });
    }

    return this.postDraftModel
      .deleteOne({ _id: new Types.ObjectId(postId) })
      .exec();
  }

  async getPost(user: User, postId: string) {
    const post = await this.postDraftModel.findById(postId);
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (post.user.toString() !== user._id.toString()) {
      throw new ForbiddenException('You are not authorized to view this post');
    }

    return post;
  }

  async publishOnLinkedIn(user: User, postId: string) {
    const post = await this.postDraftModel.findById(postId);
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (post.user.toString() !== user._id.toString()) {
      throw new ForbiddenException(
        'You are not authorized to publish this post',
      );
    }

    if (post.status === PostDraftStatus.PUBLISHED) {
      throw new BadRequestException('Post is already published');
    }

    const connectedAccount = await this.getOwnedUsableLinkedinConnectedAccount(
      user._id.toString(),
      post.connectedAccount.toString(),
      'publish posts',
    );

    const accessToken = await this.encryptionService.decrypt(
      connectedAccount.accessToken!,
    );

    const url = `${this.LINKEDIN_API_BASE}/posts`;
    const images = (post.media ?? []).filter((m) => m.type === 'IMAGE');
    const videos = (post.media ?? []).filter((m) => m.type === 'VIDEO');

    let content: IContent | undefined;
    if (videos.length === 1) {
      content = { media: { id: videos[0].id, title: videos[0].title } };
    } else if (images.length === 1) {
      content = { media: { id: images[0].id, title: images[0].title, altText: images[0].altText } };
    } else if (images.length > 1) {
      content = { multiImage: { images: images.map((m) => ({ id: m.id, altText: m.altText })) } };
    }

    const data: ILinkedInPost = {
      author: this.resolveLinkedinAuthorUrn(connectedAccount),
      commentary: post.content
        ? formatLinkedinContent(post.content)
        : undefined,
      content,
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };

    try {
      const { response } = await apiFetch<any>(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
          'LinkedIn-Version': '202601',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(data),
      });

      const postId = response.headers.get('x-restli-id');
      if (postId) {
        post.channelPostId = postId;
      }
      post.status = PostDraftStatus.PUBLISHED;
      await post.save();
    } catch (error) {
      this.logger.error(error);
      if (
        error instanceof ApiError &&
        error.statusCode === 400 &&
        typeof error.data?.message === 'string' &&
        error.data.message.includes('Organization permissions must be used')
      ) {
        throw new BadRequestException(
          'Your LinkedIn account needs to be reconnected to enable company page posting. Please disconnect and reconnect your LinkedIn account.',
        );
      }
      throw new InternalServerErrorException('Failed to publish post');
    }
  }

  async schedulePost(user: User, postId: string, dto: SchedulePostDto) {
    const post = await this.postDraftModel.findById(postId);
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (post.user.toString() !== user._id.toString()) {
      throw new ForbiddenException(
        'You are not authorized to schedule this post',
      );
    }

    if (post.status === PostDraftStatus.PUBLISHED) {
      throw new BadRequestException('Post is already published');
    }

    await this.getOwnedUsableLinkedinConnectedAccount(
      user._id.toString(),
      post.connectedAccount.toString(),
      'schedule posts',
    );

    const isFirstTimeSchedule = post.status !== PostDraftStatus.SCHEDULED;
    if (isFirstTimeSchedule) {
      await this.featureGatingService.assertScheduledPostQuota(
        user._id.toString(),
      );
    }

    const scheduledDate = new Date(dto.scheduledTime);
    const now = new Date();
    const delay = scheduledDate.getTime() - now.getTime();

    if (delay <= 0) {
      throw new BadRequestException('Scheduled time must be in the future');
    }

    if (post.status === PostDraftStatus.SCHEDULED) {
      const scheduledJob = await this.scheduleQueue.queue.getJob(
        post._id.toString(),
      );
      if (scheduledJob) {
        await scheduledJob.remove();
      }
    }

    post.status = PostDraftStatus.SCHEDULED;
    post.scheduledAt = scheduledDate;
    await post.save();

    await this.scheduleQueue.addScheduleJob(
      post._id.toString(),
      user._id.toString(),
      delay,
    );

    if (isFirstTimeSchedule) {
      await this.featureGatingService.incrementScheduledPostUsage(
        user._id.toString(),
      );
    }

    return post;
  }

  async addLinkedinMedia(
    user: User,
    postId: string,
    files: Express.Multer.File[],
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files provided');
    }

    try {
      const post = await this.postDraftModel.findById(postId);
      if (!post) {
        throw new NotFoundException('Post not found');
      }

      if (post.user.toString() !== user._id.toString()) {
        throw new ForbiddenException('You are not authorized to edit this post');
      }

      if (post.status === PostDraftStatus.PUBLISHED) {
        throw new BadRequestException('Post is already published');
      }

      const imageFiles = files.filter((f) => f.mimetype.startsWith('image/'));
      const videoFiles = files.filter((f) => f.mimetype.startsWith('video/'));

      if (imageFiles.length > 0 && videoFiles.length > 0) {
        throw new BadRequestException('Cannot mix images and videos in one post');
      }
      if (videoFiles.length > 1) {
        throw new BadRequestException('Only one video per post is allowed');
      }

      const allowedImageMimes = new Set(['image/jpeg', 'image/png']);
      for (const f of imageFiles) {
        if (!allowedImageMimes.has(f.mimetype)) {
          throw new BadRequestException(
            `Unsupported image format: ${f.mimetype}. Use JPEG or PNG`,
          );
        }
      }

      const connectedAccount = await this.getOwnedUsableLinkedinConnectedAccount(
        user._id.toString(),
        post.connectedAccount.toString(),
        'upload media',
      );

      const accessToken = await this.encryptionService.decrypt(
        connectedAccount.accessToken!,
      );

      const ownerUrn = this.resolveLinkedinAuthorUrn(connectedAccount);
      const newMediaItems: NonNullable<typeof post.media> = [];

      if (videoFiles.length === 1) {
        const urn = await this.uploadLinkedinVideo(ownerUrn, accessToken, videoFiles[0]);
        newMediaItems.push({ id: urn, type: 'VIDEO', title: videoFiles[0].originalname });
      } else {
        for (const file of imageFiles) {
          const urn = await this.uploadLinkedinImage(ownerUrn, accessToken, file);
          newMediaItems.push({
            id: urn,
            type: 'IMAGE',
            title: file.originalname,
            altText: file.originalname,
          });
        }
      }

      post.media = [...(post.media ?? []), ...newMediaItems];
      await post.save();
    } finally {
      await Promise.allSettled(files.map((f) => unlink(f.path)));
    }
  }

  private async uploadLinkedinImage(
    urn: string,
    accessToken: string,
    file: Express.Multer.File,
  ) {
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
              owner: urn,
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
        body: Readable.toWeb(createReadStream(file.path)) as any,
        ...({ duplex: 'half' } as any),
      });

      return initializeUploadRequest.data.value.image;
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.statusCode === 400 &&
        typeof error.data?.message === 'string' &&
        error.data.message.includes('Organization permissions must be used')
      ) {
        throw new BadRequestException(
          'Your LinkedIn account needs to be reconnected to enable company page posting. Please disconnect and reconnect your LinkedIn account.',
        );
      }
      throw error;
    }
  }

  private async uploadLinkedinVideo(
    ownerUrn: string,
    accessToken: string,
    file: Express.Multer.File,
  ): Promise<string> {
    const CHUNK_SIZE = 4_194_304;
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
            fileSizeBytes: file.size,
            uploadCaptions: false,
            uploadThumbnail: false,
          },
        }),
      },
    );

    const { video: videoUrn, uploadToken, uploadInstructions } =
      initRes.data.value;

    const eTags: string[] = [];
    for (const instruction of uploadInstructions) {
      const chunk = Readable.toWeb(
        createReadStream(file.path, { start: instruction.firstByte, end: instruction.lastByte }),
      );
      const { response } = await apiFetch<void>(instruction.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: chunk as any,
        ...({ duplex: 'half' } as any),
      });
      const etag = response.headers.get('etag') ?? response.headers.get('ETag');
      if (!etag) {
        throw new InternalServerErrorException(
          'LinkedIn video chunk upload did not return an ETag',
        );
      }
      eTags.push(etag);
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
    timeoutMs = 60_000,
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

  async getLinkedinImage(user: User, urn: string) {
    const connectedAccount = await this.connectedAccountModel.findOne({
      user: user._id,
      provider: AccountProvider.LINKEDIN,
    });

    if (!connectedAccount) {
      throw new NotFoundException('Connected account not found');
    }
    if (!this.isLinkedinAccountUsable(connectedAccount)) {
      throw new ConflictException(
        'Reconnect connected account to fetch LinkedIn images.',
      );
    }

    const accessToken = await this.encryptionService.decrypt(
      connectedAccount.accessToken!,
    );

    const url = `${this.LINKEDIN_API_BASE}/images/${encodeURIComponent(urn)}`;

    try {
      const { response, data } = await apiFetch<any>(url, {
        method: 'GET',
        headers: {
          'X-Restli-Protocol-Version': '2.0.0',
          'LinkedIn-Version': '202601',
          Authorization: `Bearer ${accessToken}`,
        },
      });

      return {
        downloadUrl: data.downloadUrl,
        downloadUrlExpiresAt: data.downloadUrlExpiresAt,
      };
    } catch (error) {
      this.logger.error(error);
      throw new InternalServerErrorException(
        'Failed to fetch LinkedIn image details',
      );
    }
  }

  async getPostMetrics(user: User, connectedAccountId: string) {
    const connectedAccount =
      await this.connectedAccountModel.findById(connectedAccountId);
    if (!connectedAccount) {
      throw new NotFoundException('Connected account not found');
    }

    if (connectedAccount.user.toString() !== user._id.toString()) {
      throw new ForbiddenException(
        'You are not authorized to view metrics for this account',
      );
    }

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const metrics = await this.postDraftModel.aggregate([
      {
        $match: {
          user: user._id,
          connectedAccount: new Types.ObjectId(connectedAccountId),
          createdAt: { $gte: sixMonthsAgo },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m',
              date: '$createdAt',
            },
          },
          count: { $sum: 1 },
        },
      },
      {
        $sort: { _id: 1 },
      },
      {
        $project: {
          _id: 0,
          month: '$_id',
          count: 1,
        },
      },
    ]);

    const total = metrics.reduce((sum, item) => sum + item.count, 0);

    return {
      total,
      monthly: metrics,
    };
  }

  private async getOwnedLinkedinConnectedAccount(
    userId: string,
    connectedAccountId: string,
  ): Promise<ConnectedAccount> {
    const connectedAccount =
      await this.connectedAccountModel.findById(connectedAccountId);
    if (!connectedAccount) {
      throw new NotFoundException('Connected account not found');
    }

    if (connectedAccount.user.toString() !== userId) {
      throw new ForbiddenException('Connected account is not owned by user');
    }

    if (connectedAccount.provider !== AccountProvider.LINKEDIN) {
      throw new BadRequestException('Connected account must be LinkedIn');
    }

    return connectedAccount;
  }

  private async getOwnedUsableLinkedinConnectedAccount(
    userId: string,
    connectedAccountId: string,
    action: string,
  ): Promise<ConnectedAccount> {
    const connectedAccount = await this.getOwnedLinkedinConnectedAccount(
      userId,
      connectedAccountId,
    );

    if (!this.isLinkedinAccountUsable(connectedAccount)) {
      throw new ConflictException(`Reconnect connected account to ${action}.`);
    }

    return connectedAccount;
  }

  private isLinkedinAccountUsable(connectedAccount: ConnectedAccount): boolean {
    return Boolean(connectedAccount.isActive && connectedAccount.accessToken);
  }

  private resolveLinkedinAuthorUrn(connectedAccount: ConnectedAccount): string {
    if (
      connectedAccount.accountType === LinkedinAccountType.ORGANIZATION ||
      connectedAccount.profileMetadata?.organizationUrn
    ) {
      const organizationId =
        connectedAccount.externalId ??
        connectedAccount.profileMetadata?.organizationUrn?.split(':').pop();
      if (!organizationId) {
        throw new BadRequestException(
          'Connected organization account is missing organization identifier',
        );
      }
      return `urn:li:organization:${organizationId}`;
    }

    const profileSub =
      connectedAccount.profileMetadata?.sub ??
      connectedAccount.externalId ??
      connectedAccount.impersonatorUrn?.split(':').pop();
    if (!profileSub) {
      throw new BadRequestException(
        'Connected personal account is missing LinkedIn profile identifier',
      );
    }

    return `urn:li:person:${profileSub}`;
  }
}
