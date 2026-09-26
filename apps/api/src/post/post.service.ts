import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ScheduleQueue } from '../workflow/schedule.queue';
import {
  MediaUploadQueue,
  MediaUploadJobItem,
} from '../workflow/media-upload.queue';
import {
  CompleteMediaUploadDto,
  CreatePostDto,
  InitiateMediaUploadDto,
  MAX_MEDIA_FILES_PER_POST,
  SchedulePostDto,
  UpdateMediaDto,
  UpdatePostDto,
} from './dto';
import {
  AccountProvider,
  Artifact,
  ArtifactType,
  ConnectedAccount,
  LinkedinAccountType,
  Post,
  PostMedia,
  PostMediaStatus,
  PostMediaType,
  PostStatus,
  User,
  VersionStatus,
} from 'src/database/schemas';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import { ApiError, apiFetch } from 'src/common/HelperFn/apiFetch.helper';
import { EncryptionService } from 'src/encryption/encryption.service';
import { IContent, ILinkedInPost } from './post.interface';
import { formatLinkedinContent } from 'src/common/HelperFn';
import { FeatureGatingService } from '../feature-gating/feature-gating.service';
import { deleteFile, getFile, getSignedUploadUrl, headFile } from 'src/s3';
import { LinkedinMediaService } from './linkedin-media.service';
import type { DocumentContent, PollContent } from '../artifact/schemas';
import { CONTENT_TITLE_MAX_LENGTH } from '../common/constants';
import { randomUUID } from 'crypto';
import { isLinkedinAccessUsable } from '../common/HelperFn/linkedin-access.helper';

interface PostFilters {
  availableMonths: string[];
  connectedAccountIds: string[];
}

const POST_PAGE_SIZE = 20;
const PUBLISH_RECONNECT_MESSAGE =
  'Reconnect connected account to publish posts.';

export interface PostArtifactMetadata {
  _id: Types.ObjectId;
  type: ArtifactType;
  title?: string;
  source: { prompt: string };
}

export interface PopulatedPostArtifactReference {
  artifact: PostArtifactMetadata;
  version: number;
}

export type PostListItem = Omit<Post, 'artifacts'> & {
  artifacts: PopulatedPostArtifactReference[];
};

export interface PostDetail extends Record<string, unknown> {
  artifacts: Array<{
    artifact: PostArtifactMetadata;
    version: Artifact['versions'][number];
  }>;
}

export interface GetPostsResult {
  data: PostListItem[];
  filters: PostFilters;
}

export interface ComparePostsResult {
  current: { month: string; count: number };
  previous: { month: string; count: number };
  difference: number;
  percentageChange: number | null;
}

@Injectable()
export class PostService {
  private readonly logger = new Logger(PostService.name);
  private readonly LINKEDIN_API_BASE = 'https://api.linkedin.com/rest';
  private readonly MEDIA_UPLOAD_SLOT_TTL_MS = 30 * 60 * 1000;

  private referenceId(
    reference: User | ConnectedAccount | Types.ObjectId,
  ): string {
    if (reference instanceof Types.ObjectId) return reference.toHexString();
    return reference._id.toHexString();
  }

  constructor(
    private readonly scheduleQueue: ScheduleQueue,
    private readonly mediaUploadQueue: MediaUploadQueue,
    @InjectModel(Post.name)
    private readonly postModel: Model<Post>,
    @InjectModel(Artifact.name)
    private readonly artifactModel: Model<Artifact>,
    @InjectModel(ConnectedAccount.name)
    private readonly connectedAccountModel: Model<ConnectedAccount>,
    private readonly encryptionService: EncryptionService,
    private readonly featureGatingService: FeatureGatingService,
    private readonly linkedinMediaService: LinkedinMediaService,
  ) {}

  async createPost(user: User, dto: CreatePostDto): Promise<Post> {
    if ('scheduledAt' in dto) {
      throw new BadRequestException(
        'scheduledAt is not accepted when creating a draft',
      );
    }
    const artifact = await this.artifactModel.findById(dto.artifactId);
    if (!artifact) throw new NotFoundException('Artifact not found');
    if (this.referenceId(artifact.user) !== user._id.toString()) {
      throw new ForbiddenException(
        'You are not authorized to publish this artifact',
      );
    }

    const versionNumber = dto.version ?? artifact.currentVersion;
    const version = artifact.versions.find(
      (candidate) => candidate.version === versionNumber,
    );
    if (!version || version.status !== VersionStatus.READY) {
      throw new BadRequestException(
        'Artifact version must be READY to publish',
      );
    }

    const connectedAccount = await this.getOwnedUsableLinkedinConnectedAccount(
      user._id.toString(),
      dto.connectedAccount,
      'create post drafts',
    );
    if (connectedAccount.accountType === LinkedinAccountType.ORGANIZATION) {
      await this.featureGatingService.assertCompanyPagesAccess(
        user._id.toString(),
      );
    }

    const post = new this.postModel({
      user: user._id,
      connectedAccount: new Types.ObjectId(dto.connectedAccount),
      title:
        dto.title !== undefined
          ? this.normalizePostTitle(dto.title)
          : this.defaultPostTitle(artifact),
      artifacts: [
        {
          artifact: new Types.ObjectId(dto.artifactId),
          version: versionNumber,
        },
      ],
      status: PostStatus.DRAFT,
    });
    await post.save();
    return post;
  }

  async publishPost(postId: string): Promise<Post> {
    const post = await this.postModel.findById(postId);
    if (!post) throw new NotFoundException('Post not found');
    if (post.status === PostStatus.PUBLISHED) {
      throw new BadRequestException('Post is already published');
    }

    let connectedAccount: ConnectedAccount;
    try {
      connectedAccount = await this.getOwnedUsableLinkedinConnectedAccount(
        this.referenceId(post.user),
        this.referenceId(post.connectedAccount),
        'publish posts',
      );
    } catch (error) {
      if (error instanceof ConflictException) {
        await this.failPost(post, PUBLISH_RECONNECT_MESSAGE);
      }
      throw error;
    }

    const source = post.artifacts[0];
    if (source) {
      await this.bumpArtifactPinRevision(source.artifact, source.version);
    }
    const artifact = source
      ? await this.artifactModel.findById(source.artifact)
      : null;
    const version = artifact?.versions.find(
      (candidate) => candidate.version === source?.version,
    );
    if (
      !artifact ||
      artifact.deletedAt ||
      !Object.values(ArtifactType).includes(artifact.type) ||
      !version ||
      version.status !== VersionStatus.READY
    ) {
      await this.failPost(post, 'source artifact unavailable');
      throw new BadRequestException('source artifact unavailable');
    }
    await this.assertMediaReadyForPublication(post, artifact.type);

    try {
      const accessToken = await this.encryptionService.decrypt(
        connectedAccount.accessToken!,
      );
      const author = this.resolveLinkedinAuthorUrn(connectedAccount);
      let content: IContent | undefined;
      if (artifact.type === ArtifactType.POST) {
        content = this.composeUploadedMedia(post.media);
      } else if (artifact.type === ArtifactType.POLL) {
        const pollContent = version.content as unknown as PollContent;
        const durationByDays = {
          1: 'ONE_DAY',
          3: 'THREE_DAYS',
          7: 'SEVEN_DAYS',
          14: 'FOURTEEN_DAYS',
        } as const;
        content = {
          poll: {
            question: pollContent.poll.question,
            options: pollContent.poll.options.map((text) => ({ text })),
            settings: {
              duration: durationByDays[pollContent.poll.durationDays],
              voteSelectionType: 'SINGLE_VOTE',
              isVoterVisibleToAuthor: true,
            },
          },
        };
      } else if (artifact.type === ArtifactType.DOCUMENT) {
        const documentContent = version.content as unknown as DocumentContent;
        const { pdfKey, pageCount, slides } = documentContent.document;
        if (!pdfKey || !pageCount) {
          throw new BadRequestException('source artifact unavailable');
        }
        const bytes = await getFile(pdfKey);
        const documentUrn = await this.linkedinMediaService.uploadDocument(
          author,
          accessToken,
          bytes,
          pageCount,
        );
        const cover = slides[0];
        const title =
          cover?.type === 'cover' ? cover.fields.title : 'LinkedIn document';
        content = { media: { id: documentUrn, title } };
      }
      const data: ILinkedInPost = {
        author,
        commentary:
          typeof version.content.commentary === 'string'
            ? formatLinkedinContent(version.content.commentary)
            : '',
        ...(content ? { content } : {}),
        visibility: 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      };
      const { response } = await apiFetch<unknown>(
        `${this.LINKEDIN_API_BASE}/posts`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Restli-Protocol-Version': '2.0.0',
            'LinkedIn-Version': '202601',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(data),
        },
      );
      const channelPostId = response.headers.get('x-restli-id');
      if (channelPostId) post.channelPostId = channelPostId;
      post.status = PostStatus.PUBLISHED;
      post.publishedAt = new Date();
      post.failureReason = undefined;
      await post.save();
      return post;
    } catch (error) {
      this.logger.error(error);
      const accessExpired =
        error instanceof ApiError && error.statusCode === 401;
      const reconnectRequired =
        error instanceof ApiError &&
        error.statusCode === 400 &&
        typeof error.data?.message === 'string' &&
        error.data.message.includes('Organization permissions must be used');
      const failureReason = accessExpired
        ? PUBLISH_RECONNECT_MESSAGE
        : reconnectRequired
          ? 'Your LinkedIn account needs to be reconnected to enable company page posting. Please disconnect and reconnect your LinkedIn account.'
          : 'Failed to publish post';
      await this.failPost(post, failureReason);
      if (accessExpired) throw new ConflictException(failureReason);
      if (reconnectRequired) throw new BadRequestException(failureReason);
      throw new InternalServerErrorException(failureReason);
    }
  }

  async updatePost(
    user: User,
    postId: string,
    dto: UpdatePostDto,
  ): Promise<Post> {
    const post = await this.postModel.findById(postId);
    if (!post) throw new NotFoundException('Post not found');
    if (this.referenceId(post.user) !== user._id.toString()) {
      throw new ForbiddenException('You are not authorized to edit this post');
    }
    if (post.status !== PostStatus.DRAFT && post.status !== PostStatus.FAILED) {
      throw new BadRequestException('Post cannot be edited');
    }

    if (dto.version !== undefined && dto.artifactId === undefined) {
      throw new BadRequestException('version requires artifactId');
    }
    if (dto.title === undefined && dto.artifactId === undefined) {
      throw new BadRequestException('At least one post field must be provided');
    }

    if (dto.artifactId !== undefined) {
      const artifact = await this.artifactModel.findById(dto.artifactId);
      if (!artifact) throw new NotFoundException('Artifact not found');
      if (this.referenceId(artifact.user) !== user._id.toString()) {
        throw new ForbiddenException(
          'You are not authorized to attach this artifact',
        );
      }
      const versionNumber = dto.version ?? artifact.currentVersion;
      const version = artifact.versions.find(
        (candidate) => candidate.version === versionNumber,
      );
      if (!version || version.status !== VersionStatus.READY) {
        throw new BadRequestException(
          'Artifact version must be READY to attach',
        );
      }
      if (
        (post.media?.length ?? 0) > 0 &&
        artifact.type !== ArtifactType.POST
      ) {
        throw new BadRequestException(
          'Uploaded media can only be attached to POST artifacts',
        );
      }

      post.artifacts = [
        {
          artifact: new Types.ObjectId(dto.artifactId),
          version: versionNumber,
        },
      ];
    }

    if (dto.title !== undefined) {
      post.title = this.normalizePostTitle(dto.title);
    }
    this.returnFailedPostToDraft(post);
    await post.save();
    return post;
  }

  private normalizePostTitle(title: unknown): string {
    if (typeof title !== 'string') {
      throw new BadRequestException(
        `title must be between 1 and ${CONTENT_TITLE_MAX_LENGTH} characters`,
      );
    }
    const normalized = title.trim();
    if (
      normalized.length === 0 ||
      normalized.length > CONTENT_TITLE_MAX_LENGTH
    ) {
      throw new BadRequestException(
        `title must be between 1 and ${CONTENT_TITLE_MAX_LENGTH} characters`,
      );
    }
    return normalized;
  }

  private defaultPostTitle(artifact: Artifact): string {
    const artifactTitle = artifact.title?.trim();
    if (artifactTitle) {
      return artifactTitle.slice(0, CONTENT_TITLE_MAX_LENGTH);
    }
    return artifact.source.prompt.trim().slice(0, CONTENT_TITLE_MAX_LENGTH);
  }

  async initiateMediaUpload(
    user: User,
    postId: string,
    dto: InitiateMediaUploadDto,
  ): Promise<{
    expiresAt: Date;
    uploads: Array<{
      mediaId: string;
      uploadUrl: string;
      requiredHeaders: Record<string, string>;
    }>;
  }> {
    const post = await this.getOwnedEditablePost(user, postId);
    await this.assertPostAcceptsUploadedMedia(post);
    this.purgeExpiredPendingMedia(post);
    if (this.hasMediaUploadInProgress(post)) {
      throw new ConflictException(
        'A media upload is already in progress for this post',
      );
    }

    const incomingType = this.validateMediaFiles(post.media, dto);
    await this.getOwnedUsableLinkedinConnectedAccount(
      user._id.toString(),
      this.referenceId(post.connectedAccount),
      'upload media',
    );

    const expiresAt = new Date(Date.now() + this.MEDIA_UPLOAD_SLOT_TTL_MS);
    const ttlSeconds = Math.floor(this.MEDIA_UPLOAD_SLOT_TTL_MS / 1000);
    const media: PostMedia[] = [];
    const uploads: Array<{
      mediaId: string;
      uploadUrl: string;
      requiredHeaders: Record<string, string>;
    }> = [];

    for (const file of dto.files) {
      const mediaId = randomUUID();
      const r2Key = this.mediaR2Key(postId, mediaId);
      uploads.push({
        mediaId,
        uploadUrl: await getSignedUploadUrl(
          r2Key,
          file.mimeType,
          file.sizeBytes,
          ttlSeconds,
        ),
        requiredHeaders: {
          'Content-Type': file.mimeType,
          'Content-Length': String(file.sizeBytes),
        },
      });
      media.push({
        id: mediaId,
        type: incomingType,
        title: file.fileName,
        ...(incomingType === PostMediaType.IMAGE
          ? { altText: file.fileName }
          : {}),
        status: PostMediaStatus.PENDING,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        pendingExpiresAt: expiresAt,
      });
    }

    post.media = [...(post.media ?? []), ...media];
    this.returnFailedPostToDraft(post);
    post.markModified('media');
    await post.save();
    return { expiresAt, uploads };
  }

  async completeMediaUpload(
    user: User,
    postId: string,
    dto: CompleteMediaUploadDto,
  ): Promise<PostMedia[]> {
    const post = await this.getOwnedEditablePost(user, postId);
    await this.assertPostAcceptsUploadedMedia(post);
    const now = Date.now();
    const entries = [...new Set(dto.mediaIds)].map((mediaId) => {
      const entry = post.media.find((candidate) => candidate.id === mediaId);
      if (!entry) throw new NotFoundException(`Unknown media id: ${mediaId}`);
      if (entry.status !== PostMediaStatus.PENDING) {
        throw new ConflictException(
          `Media ${mediaId} is not awaiting upload confirmation`,
        );
      }
      if (!entry.pendingExpiresAt || entry.pendingExpiresAt.getTime() <= now) {
        throw new ConflictException(
          'Upload slot expired. Re-initiate the upload.',
        );
      }
      return entry;
    });

    const account = await this.getOwnedUsableLinkedinConnectedAccount(
      user._id.toString(),
      this.referenceId(post.connectedAccount),
      'upload media',
    );
    const items: MediaUploadJobItem[] = [];
    for (const entry of entries) {
      const r2Key = this.mediaR2Key(postId, entry.id);
      const head = await headFile(r2Key);
      if (!head) {
        throw new BadRequestException(
          `File for media ${entry.id} was not uploaded`,
        );
      }
      if (
        head.sizeBytes !== entry.sizeBytes ||
        (head.mimeType && head.mimeType !== entry.mimeType)
      ) {
        throw new BadRequestException(
          `Uploaded file for media ${entry.id} does not match the declared size or type`,
        );
      }
      items.push({
        mediaId: entry.id,
        r2Key,
        mediaType: entry.type,
      });
    }

    for (const entry of entries) {
      entry.status = PostMediaStatus.UPLOADING;
      entry.pendingExpiresAt = undefined;
    }
    this.purgeExpiredPendingMedia(post);
    this.returnFailedPostToDraft(post);
    post.markModified('media');
    await post.save();
    try {
      await this.mediaUploadQueue.addMediaUploadJob({
        postId,
        connectedAccountId: this.referenceId(post.connectedAccount),
        ownerUrn: this.resolveLinkedinAuthorUrn(account),
        items,
      });
    } catch (error) {
      for (const entry of entries) entry.status = PostMediaStatus.FAILED;
      post.markModified('media');
      await post.save();
      throw error;
    }
    return entries;
  }

  async updateMedia(
    user: User,
    postId: string,
    mediaId: string,
    dto: UpdateMediaDto,
  ): Promise<PostMedia> {
    const post = await this.getOwnedEditablePost(user, postId);
    const media = post.media.find((candidate) => candidate.id === mediaId);
    if (!media) throw new NotFoundException('Media not found');
    if (dto.title !== undefined) media.title = dto.title;
    if (dto.altText !== undefined) {
      if (media.type !== PostMediaType.IMAGE) {
        throw new BadRequestException('altText is only supported for images');
      }
      media.altText = dto.altText;
    }
    this.returnFailedPostToDraft(post);
    post.markModified('media');
    await post.save();
    return media;
  }

  async removeMedia(
    user: User,
    postId: string,
    mediaId: string,
  ): Promise<PostMedia[]> {
    const post = await this.getOwnedEditablePost(user, postId);
    const media = post.media.find((candidate) => candidate.id === mediaId);
    if (!media) throw new NotFoundException('Media not found');
    post.media = post.media.filter((candidate) => candidate.id !== mediaId);
    this.returnFailedPostToDraft(post);
    post.markModified('media');
    await post.save();
    if (
      media.status === PostMediaStatus.PENDING ||
      media.status === PostMediaStatus.UPLOADING
    ) {
      await deleteFile(this.mediaR2Key(postId, mediaId)).catch((error) =>
        this.logger.warn(
          `Failed to delete R2 object for media ${mediaId}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
    return post.media;
  }

  async getMediaPreview(
    user: User,
    postId: string,
    mediaId: string,
  ): Promise<{ downloadUrl: string; downloadUrlExpiresAt?: number }> {
    const post = await this.getOwnedPost(user, postId);
    const media = post.media.find((candidate) => candidate.id === mediaId);
    if (!media) throw new NotFoundException('Media not found');
    if (media.status !== PostMediaStatus.READY || !media.linkedinUrn) {
      throw new ConflictException('Media is not ready for preview');
    }
    const account = await this.getOwnedUsableLinkedinConnectedAccount(
      user._id.toString(),
      this.referenceId(post.connectedAccount),
      'preview media',
    );
    const accessToken = await this.encryptionService.decrypt(
      account.accessToken!,
    );
    return this.linkedinMediaService.getMediaDetails(
      media.type,
      media.linkedinUrn,
      accessToken,
    );
  }

  private async failPost(post: Post, reason: string): Promise<void> {
    post.status = PostStatus.FAILED;
    post.failureReason = reason;
    await post.save();
  }

  async publishPostNow(user: User, postId: string): Promise<Post> {
    const post = await this.postModel.findById(postId);
    if (!post) throw new NotFoundException('Post not found');
    if (this.referenceId(post.user) !== user._id.toString()) {
      throw new ForbiddenException(
        'You are not authorized to publish this post',
      );
    }
    if (
      post.status !== PostStatus.DRAFT &&
      post.status !== PostStatus.SCHEDULED &&
      post.status !== PostStatus.FAILED
    ) {
      throw new BadRequestException('Post cannot be published');
    }

    await this.getOwnedUsableLinkedinConnectedAccount(
      user._id.toString(),
      this.referenceId(post.connectedAccount),
      'publish posts',
    );

    const scheduledJob = await this.scheduleQueue.queue.getJob(postId);
    if (scheduledJob) await scheduledJob.remove();

    return this.publishPost(postId);
  }

  async unschedulePost(user: User, postId: string): Promise<Post> {
    const post = await this.postModel.findById(postId);
    if (!post) throw new NotFoundException('Post not found');
    if (this.referenceId(post.user) !== user._id.toString()) {
      throw new ForbiddenException(
        'You are not authorized to unschedule this post',
      );
    }
    if (post.status !== PostStatus.SCHEDULED) {
      throw new BadRequestException('Post is not scheduled');
    }

    const job = await this.scheduleQueue.queue.getJob(postId);
    if (job) {
      try {
        await job.remove();
      } catch {
        throw new ConflictException(
          'Post is already being published and cannot be unscheduled',
        );
      }
    }
    post.status = PostStatus.DRAFT;
    post.scheduledAt = undefined;
    post.failureReason = undefined;
    await post.save();
    return post;
  }

  async getPosts(
    user: User,
    connectedAccount?: string,
    status?: string,
    month?: string,
    page = 1,
  ): Promise<GetPostsResult> {
    const filter: QueryFilter<Post> = { user: user._id };

    if (connectedAccount) {
      filter.connectedAccount = new Types.ObjectId(connectedAccount);
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

    const normalizedPage = Number.isInteger(page) && page > 0 ? page : 1;
    const postsQuery = this.postModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip((normalizedPage - 1) * POST_PAGE_SIZE)
      .limit(POST_PAGE_SIZE)
      .populate<{ artifacts: PopulatedPostArtifactReference[] }>({
        path: 'artifacts.artifact',
        select: '_id type title source.prompt',
      })
      .lean()
      .exec();

    const availableMonthsQuery = this.postModel.aggregate<{
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

    const connectedAccountIdsQuery = this.postModel.distinct(
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
        connectedAccountIds: (
          connectedAccountIds as unknown as Array<
            ConnectedAccount | Types.ObjectId
          >
        ).map((id) => this.referenceId(id)),
      },
    };
  }

  async deletePost(user: User, postId: string) {
    const post = await this.postModel.findById(postId);
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (this.referenceId(post.user) !== user._id.toString()) {
      throw new ForbiddenException(
        'You are not authorized to delete this post',
      );
    }

    const connectedAccount = await this.getOwnedLinkedinConnectedAccount(
      user._id.toString(),
      this.referenceId(post.connectedAccount),
    );
    const canUseLinkedinAccount =
      this.isLinkedinAccountUsable(connectedAccount);
    if (post.status === PostStatus.PUBLISHED && !canUseLinkedinAccount) {
      throw new ConflictException(
        'Reconnect account to delete published posts from LinkedIn safely.',
      );
    }

    if (post.status === PostStatus.SCHEDULED) {
      const scheduledJob = await this.scheduleQueue.queue.getJob(
        post._id.toString(),
      );
      if (scheduledJob) {
        await scheduledJob.remove();
      }
    }

    if (post.status === PostStatus.PUBLISHED && post.channelPostId) {
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

    return this.postModel.deleteOne({ _id: new Types.ObjectId(postId) }).exec();
  }

  async getPost(user: User, postId: string): Promise<PostDetail> {
    const post = await this.postModel
      .findById(postId)
      .populate('connectedAccount', 'displayName accountType');
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (this.referenceId(post.user) !== user._id.toString()) {
      throw new ForbiddenException('You are not authorized to view this post');
    }

    const artifacts = await Promise.all(
      post.artifacts.map(async (reference) => {
        const artifact = await this.artifactModel.findById(reference.artifact);
        const version = artifact?.versions.find(
          (candidate) => candidate.version === reference.version,
        );
        if (!artifact || !version) {
          throw new NotFoundException('Source artifact version not found');
        }

        const artifactMetadata: PostArtifactMetadata = {
          _id: artifact._id,
          type: artifact.type,
          ...(artifact.title !== undefined ? { title: artifact.title } : {}),
          source: { prompt: artifact.source.prompt },
        };
        return { artifact: artifactMetadata, version };
      }),
    );

    return {
      ...(post.toObject() as unknown as Record<string, unknown>),
      artifacts,
    };
  }

  async comparePostsByMonth(
    user: User,
    currentMonth: string,
    previousMonth: string,
  ): Promise<ComparePostsResult> {
    const currentRange = this.getUtcMonthRange(currentMonth);
    const previousRange = this.getUtcMonthRange(previousMonth);

    const [currentCount, previousCount] = await Promise.all([
      this.postModel.countDocuments({
        user: user._id,
        createdAt: { $gte: currentRange.start, $lt: currentRange.end },
      }),
      this.postModel.countDocuments({
        user: user._id,
        createdAt: { $gte: previousRange.start, $lt: previousRange.end },
      }),
    ]);

    const difference = currentCount - previousCount;
    const percentageChange =
      previousCount === 0
        ? null
        : Math.round((difference / previousCount) * 10_000) / 100;

    return {
      current: { month: currentMonth, count: currentCount },
      previous: { month: previousMonth, count: previousCount },
      difference,
      percentageChange,
    };
  }

  async schedulePost(user: User, postId: string, dto: SchedulePostDto) {
    const post = await this.postModel.findById(postId);
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (this.referenceId(post.user) !== user._id.toString()) {
      throw new ForbiddenException(
        'You are not authorized to schedule this post',
      );
    }

    if (post.status === PostStatus.PUBLISHED) {
      throw new BadRequestException('Post is already published');
    }

    if (
      post.status !== PostStatus.DRAFT &&
      post.status !== PostStatus.SCHEDULED &&
      post.status !== PostStatus.FAILED
    ) {
      throw new BadRequestException('Post cannot be scheduled');
    }

    const scheduledDate = new Date(dto.scheduledAt);
    const delay = scheduledDate.getTime() - Date.now();
    if (delay <= 0) {
      throw new BadRequestException('Scheduled time must be in the future');
    }

    await this.getOwnedUsableLinkedinConnectedAccount(
      user._id.toString(),
      this.referenceId(post.connectedAccount),
      'schedule posts',
    );
    if ((post.media?.length ?? 0) > 0) {
      const source = post.artifacts[0];
      const artifact = source
        ? await this.artifactModel.findById(source.artifact)
        : null;
      if (!artifact)
        throw new BadRequestException('source artifact unavailable');
      await this.assertMediaReadyForPublication(post, artifact.type);
    }

    const legacyScheduleWasCounted =
      post.scheduledPostUsageCounted === undefined &&
      (post.status === PostStatus.SCHEDULED || Boolean(post.scheduledAt));
    const usageWasCounted =
      post.scheduledPostUsageCounted === true ||
      legacyScheduleWasCounted ||
      (await this.featureGatingService.hasScheduledPostUsage(
        user._id.toString(),
        post._id.toString(),
      ));
    const isFirstTimeSchedule = !usageWasCounted;
    if (isFirstTimeSchedule) {
      await this.featureGatingService.assertScheduledPostQuota(
        user._id.toString(),
      );
    }

    const source = post.artifacts?.[0];
    if (source) {
      await this.bumpArtifactPinRevision(source.artifact, source.version);
    }

    const scheduledJob = await this.scheduleQueue.queue.getJob(
      post._id.toString(),
    );
    const previousScheduledAt = post.scheduledAt
      ? new Date(post.scheduledAt)
      : undefined;
    if (scheduledJob) {
      await scheduledJob.remove();
    }

    try {
      await this.scheduleQueue.addScheduleJob(
        post._id.toString(),
        user._id.toString(),
        delay,
      );
    } catch (error) {
      if (scheduledJob && previousScheduledAt) {
        const previousDelay = previousScheduledAt.getTime() - Date.now();
        if (previousDelay > 0) {
          try {
            await this.scheduleQueue.addScheduleJob(
              post._id.toString(),
              user._id.toString(),
              previousDelay,
            );
          } catch (restoreError) {
            post.status = PostStatus.DRAFT;
            post.scheduledAt = undefined;
            post.failureReason = 'Previous schedule could not be restored';
            await post.save();
            this.logger.error(restoreError);
          }
        }
      }
      throw error;
    }

    post.status = PostStatus.SCHEDULED;
    post.scheduledAt = scheduledDate;
    post.failureReason = undefined;
    await post.save();

    if (isFirstTimeSchedule) {
      await this.featureGatingService.incrementScheduledPostUsage(
        user._id.toString(),
        post._id.toString(),
      );
    }

    if (!post.scheduledPostUsageCounted) {
      post.scheduledPostUsageCounted = true;
      await post.save();
    }

    return post;
  }

  private returnFailedPostToDraft(post: Post): void {
    if (post.status !== PostStatus.FAILED) return;
    post.status = PostStatus.DRAFT;
    post.failureReason = undefined;
    post.scheduledAt = undefined;
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

    if (this.referenceId(connectedAccount.user) !== user._id.toString()) {
      throw new ForbiddenException(
        'You are not authorized to view metrics for this account',
      );
    }

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const metrics = await this.postModel.aggregate<{
      month: string;
      count: number;
    }>([
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

  private async getOwnedPost(user: User, postId: string): Promise<Post> {
    const post = await this.postModel.findById(postId);
    if (!post) throw new NotFoundException('Post not found');
    if (this.referenceId(post.user) !== user._id.toString()) {
      throw new ForbiddenException(
        'You are not authorized to access this post',
      );
    }
    return post;
  }

  private async getOwnedEditablePost(
    user: User,
    postId: string,
  ): Promise<Post> {
    const post = await this.getOwnedPost(user, postId);
    if (post.status !== PostStatus.DRAFT && post.status !== PostStatus.FAILED) {
      throw new BadRequestException('Post cannot be edited');
    }
    post.media ??= [];
    return post;
  }

  private async assertPostAcceptsUploadedMedia(post: Post): Promise<void> {
    const source = post.artifacts[0];
    const artifact = source
      ? await this.artifactModel.findById(source.artifact)
      : null;
    if (!artifact || artifact.type !== ArtifactType.POST) {
      throw new BadRequestException(
        'Uploaded media can only be attached to POST artifacts',
      );
    }
  }

  private validateMediaFiles(
    existing: PostMedia[],
    dto: InitiateMediaUploadDto,
  ): PostMediaType {
    const imageMimes = new Set(['image/jpeg', 'image/png']);
    const images = dto.files.filter((file) => imageMimes.has(file.mimeType));
    const videos = dto.files.filter((file) => file.mimeType === 'video/mp4');
    if (images.length + videos.length !== dto.files.length) {
      const unsupported = dto.files.find(
        (file) =>
          !imageMimes.has(file.mimeType) && file.mimeType !== 'video/mp4',
      );
      throw new BadRequestException(
        `Unsupported file type: ${unsupported?.mimeType}`,
      );
    }
    if (images.length > 0 && videos.length > 0) {
      throw new BadRequestException('Cannot mix images and videos in one post');
    }
    if (videos.length > 1) {
      throw new BadRequestException('Only one video per post is allowed');
    }

    const existingImages = existing.filter(
      (media) => media.type === PostMediaType.IMAGE,
    ).length;
    const existingVideos = existing.filter(
      (media) => media.type === PostMediaType.VIDEO,
    ).length;
    if (
      (videos.length > 0 && existingImages > 0) ||
      (images.length > 0 && existingVideos > 0)
    ) {
      throw new BadRequestException('Cannot mix images and videos in one post');
    }
    if (videos.length + existingVideos > 1) {
      throw new BadRequestException('Only one video per post is allowed');
    }
    if (images.length + existingImages > MAX_MEDIA_FILES_PER_POST) {
      throw new BadRequestException(
        `A post cannot contain more than ${MAX_MEDIA_FILES_PER_POST} images`,
      );
    }
    return videos.length > 0 ? PostMediaType.VIDEO : PostMediaType.IMAGE;
  }

  private purgeExpiredPendingMedia(post: Post): boolean {
    const now = Date.now();
    const before = post.media?.length ?? 0;
    post.media = (post.media ?? []).filter(
      (media) =>
        media.status !== PostMediaStatus.PENDING ||
        !media.pendingExpiresAt ||
        media.pendingExpiresAt.getTime() > now,
    );
    const changed = post.media.length !== before;
    if (changed) post.markModified('media');
    return changed;
  }

  private hasMediaUploadInProgress(post: Post): boolean {
    return (post.media ?? []).some(
      (media) =>
        media.status === PostMediaStatus.PENDING ||
        media.status === PostMediaStatus.UPLOADING,
    );
  }

  private async assertMediaReadyForPublication(
    post: Post,
    artifactType: ArtifactType,
  ): Promise<void> {
    if (this.purgeExpiredPendingMedia(post)) await post.save();
    if ((post.media?.length ?? 0) === 0) return;
    if (artifactType !== ArtifactType.POST) {
      throw new BadRequestException(
        'Uploaded media can only be attached to POST artifacts',
      );
    }
    if (
      post.media.some(
        (media) => media.status !== PostMediaStatus.READY || !media.linkedinUrn,
      )
    ) {
      throw new ConflictException(
        'Media uploads must be resolved before publishing or scheduling',
      );
    }
  }

  private composeUploadedMedia(media: PostMedia[]): IContent | undefined {
    const images = media.filter((item) => item.type === PostMediaType.IMAGE);
    const video = media.find((item) => item.type === PostMediaType.VIDEO);
    if (video?.linkedinUrn) {
      return {
        media: { id: video.linkedinUrn, title: video.title },
      };
    }
    if (images.length === 1 && images[0].linkedinUrn) {
      return {
        media: {
          id: images[0].linkedinUrn,
          title: images[0].title,
          altText: images[0].altText,
        },
      };
    }
    if (images.length > 1) {
      return {
        multiImage: {
          images: images.map((item) => ({
            id: item.linkedinUrn!,
            altText: item.altText,
          })),
        },
      };
    }
    return undefined;
  }

  private mediaR2Key(postId: string, mediaId: string): string {
    return `media-uploads/${postId}/${mediaId}`;
  }

  private async bumpArtifactPinRevision(
    artifactId: Types.ObjectId,
    version: number,
  ): Promise<void> {
    const result = await this.artifactModel.updateOne(
      { _id: artifactId, currentVersion: version },
      { $inc: { pinRevision: 1 } },
    );
    if (result.matchedCount === 0) {
      throw new ConflictException(
        'Selected artifact version changed before it could be pinned',
      );
    }
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
    return isLinkedinAccessUsable(connectedAccount);
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

  private getUtcMonthRange(month: string): { start: Date; end: Date } {
    const [year, monthNumber] = month.split('-').map(Number);
    const start = new Date(0);
    start.setUTCFullYear(year, monthNumber - 1, 1);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);

    return {
      start,
      end,
    };
  }
}
