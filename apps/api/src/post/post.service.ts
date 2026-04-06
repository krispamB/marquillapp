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
import { apiFetch } from 'src/common/HelperFn/apiFetch.helper';
import { EncryptionService } from 'src/encryption/encryption.service';
import { ILinkedInPost } from './post.interface';
import { formatLinkedinContent } from 'src/common/HelperFn';
import { FeatureGatingService } from '../feature-gating/feature-gating.service';

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
      .select('-userIntent')
      .sort({ createdAt: -1 })
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
    const data: ILinkedInPost = {
      author: this.resolveLinkedinAuthorUrn(connectedAccount),
      commentary: post.content
        ? formatLinkedinContent(post.content)
        : undefined,
      content: post.media
        ? {
            media: {
              id: post.media[0].id,
              title: post.media[0].title,
            },
          }
        : undefined,
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

    return post;
  }

  async addLinkedinMedia(
    user: User,
    postId: string,
    file: Express.Multer.File,
  ) {
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

    const connectedAccount = await this.getOwnedUsableLinkedinConnectedAccount(
      user._id.toString(),
      post.connectedAccount.toString(),
      'upload media',
    );

    const accessToken = await this.encryptionService.decrypt(
      connectedAccount.accessToken!,
    );

    const urn = await this.uploadLinkedinImage(
      this.resolveLinkedinAuthorUrn(connectedAccount),
      accessToken,
      file,
    );
    if (post.media) {
      post.media.push({
        id: urn,
        title: file.originalname,
        altText: file.originalname,
      });
    } else {
      post.media = [
        {
          id: urn,
          title: file.originalname,
          altText: file.originalname,
        },
      ];
    }
    await post.save();
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

    const uploadResponse = await apiFetch(
      initializeUploadRequest.data.value.uploadUrl,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'LinkedIn-Version': '202601',
          Authorization: `Bearer ${accessToken}`,
        },
        body: file.buffer as any,
        ...({ duplex: 'half' } as any),
      },
    );

    return initializeUploadRequest.data.value.image;
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
