import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { WorkflowQueue } from '../workflow/workflow.queue';
import { InputDto } from '../agent/dto';
import { UpdatePostDto } from './dto';
import { AccountProvider, ConnectedAccount, PostDraft, PostDraftStatus, User } from 'src/database/schemas';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { apiFetch } from 'src/common/HelperFn/apiFetch.helper';
import { EncryptionService } from 'src/encryption/encryption.service';
import { ILinkedInPost } from './post.interface';
import { formatLinkedinContent } from 'src/common/HelperFn';

@Injectable()
export class PostService {
  private readonly logger = new Logger(PostService.name);
  private readonly LINKEDIN_API_BASE = 'https://api.linkedin.com/rest/post';

  constructor(
    private readonly workflowQueue: WorkflowQueue,
    @InjectModel(PostDraft.name)
    private readonly postDraftModel: Model<PostDraft>,
    @InjectModel(ConnectedAccount.name)
    private readonly connectedAccountModel: Model<ConnectedAccount>,
    private readonly encryptionService: EncryptionService,
  ) { }

  async createDraft(user: User, accountId: string, dto: InputDto) {
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

    return workflowId;
  }

  async getStatus(id: string) {
    const job = await this.workflowQueue.queue.getJob(id);
    if (!job) return { status: 'not found' };
    const [state] = await Promise.all([job.getState()]);
    return { state, progress: job.progress };
  }

  async getPosts(user: User, accountConnected?: string) {
    const filter: any = { user: user._id };
    if (accountConnected) {
      filter.connectedAccount = new Types.ObjectId(accountConnected);
    }
    return this.postDraftModel.find(filter).exec();
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
      throw new ForbiddenException('You are not authorized to delete this post');
    }

    const connectedAccount = await this.connectedAccountModel.findOne({
      user: post.user,
      provider: AccountProvider.LINKEDIN,
    });

    if (!connectedAccount) {
      throw new NotFoundException('Connected account not found');
    }

    const accessToken = await this.encryptionService.decrypt(
      connectedAccount.accessToken,
    );

    this.logger.log(`Deleting post ${post.channelPostId} with access token ${accessToken}`);

    if (post.status === PostDraftStatus.PUBLISHED && post.channelPostId) {
      const externalUrl = `https://api.linkedin.com/rest/posts/${encodeURIComponent(post.channelPostId)}`;
      await apiFetch(externalUrl, {
        method: 'DELETE',
        headers: {
          'X-Restli-Protocol-Version': '2.0.0',
          'LinkedIn-Version': '202601',
          Authorization: `Bearer ${accessToken}`,
        }
      });
    }

    return this.postDraftModel.deleteOne({ _id: new Types.ObjectId(postId) }).exec();
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
      throw new ForbiddenException('You are not authorized to publish this post');
    }

    const connectedAccount = await this.connectedAccountModel.findOne({
      user: post.user,
      provider: AccountProvider.LINKEDIN,
    });

    if (!connectedAccount) {
      throw new NotFoundException('Connected account not found');
    }

    const accessToken = await this.encryptionService.decrypt(
      connectedAccount.accessToken,
    );

    const url = 'https://api.linkedin.com/rest/posts';
    const data: ILinkedInPost = {
      author: `urn:li:person:${connectedAccount.profileMetadata!.sub}`,
      commentary: formatLinkedinContent(post.content!),
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

      const postId = response.headers.get('x-restli-id')
      if (postId) {
        post.channelPostId = postId
      }
      post.status = PostDraftStatus.PUBLISHED;
      await post.save();

    } catch (error) {
      this.logger.error(error);
      throw new InternalServerErrorException('Failed to publish post');
    }
  }
}
