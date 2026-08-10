import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';

jest.mock(
  'src/database/schemas',
  () => ({
    AccountProvider: { LINKEDIN: 'LINKEDIN' },
    LinkedinAccountType: { PERSON: 'PERSON', ORGANIZATION: 'ORGANIZATION' },
    ConnectedAccount: { name: 'ConnectedAccount' },
    Artifact: { name: 'Artifact' },
    ArtifactType: { POST: 'POST', POLL: 'POLL', DOCUMENT: 'DOCUMENT' },
    VersionStatus: {
      GENERATING: 'GENERATING',
      READY: 'READY',
      FAILED: 'FAILED',
    },
    Post: { name: 'Post' },
    PostStatus: {
      DRAFT: 'DRAFT',
      SCHEDULED: 'SCHEDULED',
      PUBLISHED: 'PUBLISHED',
      FAILED: 'FAILED',
    },
    PostMediaType: { IMAGE: 'IMAGE', VIDEO: 'VIDEO' },
    PostMediaStatus: {
      PENDING: 'PENDING',
      UPLOADING: 'UPLOADING',
      READY: 'READY',
      FAILED: 'FAILED',
    },
    User: { name: 'User' },
  }),
  { virtual: true },
);
jest.mock(
  'src/common/HelperFn/apiFetch.helper',
  () => ({
    apiFetch: jest.fn(),
    ApiError: class ApiError extends Error {},
  }),
  { virtual: true },
);
jest.mock('src/common/HelperFn', () => ({ formatLinkedinContent: jest.fn() }), {
  virtual: true,
});
jest.mock(
  'src/encryption/encryption.service',
  () => ({ EncryptionService: class EncryptionService {} }),
  { virtual: true },
);
jest.mock(
  '../feature-gating/feature-gating.service',
  () => ({ FeatureGatingService: class FeatureGatingService {} }),
  { virtual: true },
);
jest.mock(
  'src/s3',
  () => ({
    deleteFile: jest.fn(),
    getFile: jest.fn(),
    getSignedUploadUrl: jest.fn(),
    headFile: jest.fn(),
  }),
  { virtual: true },
);
import { PostService } from './post.service';
import type { User } from 'src/database/schemas';
import { deleteFile, getFile, getSignedUploadUrl, headFile } from 'src/s3';
import { apiFetch } from 'src/common/HelperFn/apiFetch.helper';
import { formatLinkedinContent } from 'src/common/HelperFn';

describe('PostService.getPosts', () => {
  const createService = () => {
    const service = Object.create(PostService.prototype) as PostService;

    const exec = jest.fn();
    const lean = jest.fn().mockReturnValue({ exec });
    const populate = jest.fn().mockReturnValue({ lean });
    const limit = jest.fn().mockReturnValue({ lean, populate });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    const find = jest.fn().mockReturnValue({ sort });
    const aggregate = jest.fn();
    const distinct = jest.fn();

    (service as any).postModel = {
      find,
      aggregate,
      distinct,
    };

    return {
      service,
      mocks: {
        find,
        sort,
        skip,
        limit,
        populate,
        lean,
        exec,
        aggregate,
        distinct,
      },
    };
  };

  it('returns filtered posts in data and filter metadata for the user', async () => {
    const { service, mocks } = createService();
    const userId = new Types.ObjectId();
    const connectedAccountId = new Types.ObjectId();

    const posts = [
      {
        _id: new Types.ObjectId(),
        artifacts: [
          {
            artifact: {
              _id: new Types.ObjectId(),
              type: 'POST',
              title: 'Deployment safety',
              source: { prompt: 'Write about safer deployments' },
            },
            version: 2,
          },
        ],
      },
    ] as any[];
    mocks.exec.mockResolvedValue(posts);
    mocks.aggregate.mockResolvedValue([
      { month: '2026-02' },
      { month: '2026-01' },
    ]);
    mocks.distinct.mockResolvedValue([connectedAccountId]);

    const result = await service.getPosts(
      { _id: userId } as any,
      connectedAccountId.toString(),
      'SCHEDULED',
      '2026-01',
      2,
    );

    expect(mocks.find).toHaveBeenCalledTimes(1);
    expect(mocks.skip).toHaveBeenCalledWith(20);
    expect(mocks.limit).toHaveBeenCalledWith(20);
    expect(mocks.populate).toHaveBeenCalledWith({
      path: 'artifacts.artifact',
      select: '_id type title source.prompt',
    });
    expect(mocks.lean).toHaveBeenCalledTimes(1);
    const filter = mocks.find.mock.calls[0][0];
    expect(filter.user).toEqual(userId);
    expect(filter.status).toBe('SCHEDULED');
    expect(filter.connectedAccount).toEqual(connectedAccountId);
    expect(filter.updatedAt.$gte).toEqual(new Date(2026, 0, 1));
    expect(filter.updatedAt.$lt).toEqual(new Date(2026, 1, 1));

    expect(mocks.aggregate).toHaveBeenCalledWith([
      { $match: { user: userId } },
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
      { $sort: { _id: -1 } },
      { $project: { _id: 0, month: '$_id' } },
    ]);
    expect(mocks.distinct).toHaveBeenCalledWith('connectedAccount', {
      user: userId,
    });

    expect(result).toEqual({
      data: posts,
      filters: {
        availableMonths: ['2026-02', '2026-01'],
        connectedAccountIds: [connectedAccountId.toString()],
      },
    });
  });

  it('returns empty lists when user has no posts', async () => {
    const { service, mocks } = createService();
    const userId = new Types.ObjectId();

    mocks.exec.mockResolvedValue([]);
    mocks.aggregate.mockResolvedValue([]);
    mocks.distinct.mockResolvedValue([]);

    const result = await service.getPosts({ _id: userId } as any);

    expect(result).toEqual({
      data: [],
      filters: {
        availableMonths: [],
        connectedAccountIds: [],
      },
    });
  });
});

describe('PostService.getPost', () => {
  it('should resolve the pinned artifact version when the post is owned', async () => {
    const service = Object.create(PostService.prototype) as PostService;
    const userId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const artifactId = new Types.ObjectId();
    const post = {
      _id: postId,
      user: userId,
      artifacts: [{ artifact: artifactId, version: 1 }],
      toObject: () => ({
        _id: postId,
        user: userId,
        connectedAccount: {
          _id: new Types.ObjectId(),
          displayName: 'Ada Lovelace',
          accountType: 'PERSON',
        },
        artifacts: [{ artifact: artifactId, version: 1 }],
      }),
    };
    const approvedVersion = {
      version: 1,
      status: 'READY',
      content: { commentary: 'Approved copy' },
    };
    const artifact = {
      _id: artifactId,
      type: 'POST',
      source: { prompt: 'Write about approved copy' },
      pinRevision: 4,
      versions: [
        approvedVersion,
        { version: 2, status: 'READY', content: { commentary: 'New copy' } },
      ],
      toObject: () => ({
        _id: artifactId,
        type: 'POST',
        source: { prompt: 'Write about approved copy' },
        pinRevision: 4,
        versions: [approvedVersion],
      }),
    };
    const populate = jest.fn().mockResolvedValue(post);
    const findPostById = jest.fn().mockReturnValue({ populate });
    const findArtifactById = jest.fn().mockResolvedValue(artifact);
    Object.assign(service as any, {
      postModel: { findById: findPostById },
      artifactModel: { findById: findArtifactById },
    });

    const result = await service.getPost(
      { _id: userId } as any,
      postId.toString(),
    );

    expect(findArtifactById).toHaveBeenCalledWith(artifactId);
    expect(populate).toHaveBeenCalledWith(
      'connectedAccount',
      'displayName accountType',
    );
    expect(result.connectedAccount).toEqual(
      expect.objectContaining({
        displayName: 'Ada Lovelace',
        accountType: 'PERSON',
      }),
    );
    expect(result.connectedAccount).not.toHaveProperty('accessToken');
    expect(result.artifacts).toEqual([
      {
        artifact: {
          _id: artifactId,
          type: 'POST',
          source: { prompt: 'Write about approved copy' },
        },
        version: approvedVersion,
      },
    ]);
  });

  it('should reject a populated post that is not owned by the user', async () => {
    const service = Object.create(PostService.prototype) as PostService;
    const populate = jest.fn().mockResolvedValue({
      _id: new Types.ObjectId(),
      user: new Types.ObjectId(),
      connectedAccount: {
        _id: new Types.ObjectId(),
        displayName: 'Another User',
        accountType: 'PERSON',
      },
    });
    (service as any).postModel = {
      findById: jest.fn().mockReturnValue({ populate }),
    };

    await expect(
      service.getPost(
        { _id: new Types.ObjectId() } as any,
        new Types.ObjectId().toString(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('PostService.getPostMetrics', () => {
  it('should aggregate post counts when the connected account is owned', async () => {
    const service = Object.create(PostService.prototype) as PostService;
    const userId = new Types.ObjectId();
    const accountId = new Types.ObjectId();
    const aggregate = jest.fn().mockResolvedValue([
      { month: '2026-05', count: 2 },
      { month: '2026-06', count: 1 },
    ]);
    Object.assign(service as any, {
      connectedAccountModel: {
        findById: jest.fn().mockResolvedValue({ user: userId }),
      },
      postModel: { aggregate },
    });

    const result = await service.getPostMetrics(
      { _id: userId } as any,
      accountId.toString(),
    );

    expect(aggregate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          $match: expect.objectContaining({
            user: userId,
            connectedAccount: accountId,
          }),
        }),
      ]),
    );
    expect(result).toEqual({
      total: 3,
      monthly: [
        { month: '2026-05', count: 2 },
        { month: '2026-06', count: 1 },
      ],
    });
  });
});

describe('PostService.schedulePost', () => {
  const createService = () => {
    const service = Object.create(PostService.prototype) as PostService;
    const findById = jest.fn();
    const findConnectedAccountById = jest.fn();
    const save = jest.fn().mockResolvedValue(undefined);
    const addScheduleJob = jest.fn().mockResolvedValue(undefined);
    const getJob = jest.fn();
    const assertScheduledPostQuota = jest.fn().mockResolvedValue(undefined);
    const incrementScheduledPostUsage = jest.fn().mockResolvedValue(undefined);
    const hasScheduledPostUsage = jest.fn().mockResolvedValue(false);
    const updateArtifactPinRevision = jest
      .fn()
      .mockResolvedValue({ matchedCount: 1 });

    (service as any).postModel = {
      findById,
    };
    (service as any).scheduleQueue = {
      addScheduleJob,
      queue: {
        getJob,
      },
    };
    (service as any).connectedAccountModel = {
      findById: findConnectedAccountById,
    };
    (service as any).featureGatingService = {
      assertScheduledPostQuota,
      incrementScheduledPostUsage,
      hasScheduledPostUsage,
    };
    (service as any).artifactModel = {
      updateOne: updateArtifactPinRevision,
    };

    return {
      service,
      mocks: {
        findById,
        findConnectedAccountById,
        save,
        addScheduleJob,
        getJob,
        assertScheduledPostQuota,
        incrementScheduledPostUsage,
        hasScheduledPostUsage,
        updateArtifactPinRevision,
      },
    };
  };

  it('should charge first-time scheduling usage when a FAILED post is scheduled', async () => {
    const { service, mocks } = createService();
    const userId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const scheduledAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const post = {
      _id: postId,
      user: userId,
      connectedAccount: new Types.ObjectId(),
      status: 'FAILED',
      scheduledPostUsageCounted: false,
      save: mocks.save,
    } as any;

    mocks.findById.mockResolvedValue(post);
    mocks.findConnectedAccountById.mockResolvedValue({
      user: userId,
      provider: 'LINKEDIN',
      isActive: true,
      accessToken: 'encrypted-token',
    });

    const result = await service.schedulePost(
      { _id: userId } as any,
      postId.toString(),
      { scheduledAt } as any,
    );

    expect(mocks.getJob).toHaveBeenCalledWith(postId.toString());
    expect(mocks.assertScheduledPostQuota).toHaveBeenCalledWith(
      userId.toString(),
    );
    expect(mocks.addScheduleJob).toHaveBeenCalledWith(
      postId.toString(),
      userId.toString(),
      expect.any(Number),
    );
    expect(mocks.incrementScheduledPostUsage).toHaveBeenCalledWith(
      userId.toString(),
      postId.toString(),
    );
    expect(post.status).toBe('SCHEDULED');
    expect(post.scheduledAt).toEqual(new Date(scheduledAt));
    expect(post.scheduledPostUsageCounted).toBe(true);
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(result).toBe(post);
  });

  it('should avoid recharging when prior usage exists without a persisted post marker', async () => {
    const { service, mocks } = createService();
    const userId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const scheduledAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const post = {
      _id: postId,
      user: userId,
      connectedAccount: new Types.ObjectId(),
      status: 'FAILED',
      scheduledPostUsageCounted: false,
      save: mocks.save,
    } as any;
    mocks.findById.mockResolvedValue(post);
    mocks.findConnectedAccountById.mockResolvedValue({
      user: userId,
      provider: 'LINKEDIN',
      isActive: true,
      accessToken: 'encrypted-token',
    });
    mocks.hasScheduledPostUsage.mockResolvedValue(true);

    await service.schedulePost({ _id: userId } as any, postId.toString(), {
      scheduledAt,
    } as any);

    expect(mocks.assertScheduledPostQuota).not.toHaveBeenCalled();
    expect(mocks.incrementScheduledPostUsage).not.toHaveBeenCalled();
    expect(post.scheduledPostUsageCounted).toBe(true);
  });

  it('reschedules a scheduled post by removing the existing job first', async () => {
    const { service, mocks } = createService();
    const userId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const scheduledAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const remove = jest.fn().mockResolvedValue(undefined);
    const post = {
      _id: postId,
      user: userId,
      connectedAccount: new Types.ObjectId(),
      status: 'SCHEDULED',
      media: [],
      save: mocks.save,
    } as any;

    mocks.findById.mockResolvedValue(post);
    mocks.findConnectedAccountById.mockResolvedValue({
      user: userId,
      provider: 'LINKEDIN',
      isActive: true,
      accessToken: 'encrypted-token',
    });
    mocks.getJob.mockResolvedValue({ remove });

    await service.schedulePost({ _id: userId } as any, postId.toString(), {
      scheduledAt,
    } as any);

    expect(mocks.assertScheduledPostQuota).not.toHaveBeenCalled();
    expect(mocks.getJob).toHaveBeenCalledWith(postId.toString());
    expect(remove).toHaveBeenCalledTimes(1);
    expect(mocks.addScheduleJob).toHaveBeenCalledWith(
      postId.toString(),
      userId.toString(),
      expect.any(Number),
    );
    expect(mocks.incrementScheduledPostUsage).not.toHaveBeenCalled();
    expect(post.scheduledAt).toEqual(new Date(scheduledAt));
  });

  it('reschedules even when the old scheduled job is already missing', async () => {
    const { service, mocks } = createService();
    const userId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const scheduledAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const post = {
      _id: postId,
      user: userId,
      connectedAccount: new Types.ObjectId(),
      status: 'SCHEDULED',
      scheduledPostUsageCounted: true,
      save: mocks.save,
    } as any;

    mocks.findById.mockResolvedValue(post);
    mocks.findConnectedAccountById.mockResolvedValue({
      user: userId,
      provider: 'LINKEDIN',
      isActive: true,
      accessToken: 'encrypted-token',
    });
    mocks.getJob.mockResolvedValue(null);

    await service.schedulePost({ _id: userId } as any, postId.toString(), {
      scheduledAt,
    } as any);

    expect(mocks.assertScheduledPostQuota).not.toHaveBeenCalled();
    expect(mocks.getJob).toHaveBeenCalledWith(postId.toString());
    expect(mocks.addScheduleJob).toHaveBeenCalledTimes(1);
    expect(mocks.incrementScheduledPostUsage).not.toHaveBeenCalled();
  });

  it('fails rescheduling if removing previous scheduled job throws', async () => {
    const { service, mocks } = createService();
    const userId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const scheduledAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const remove = jest.fn().mockRejectedValue(new Error('remove failed'));
    const post = {
      _id: postId,
      user: userId,
      connectedAccount: new Types.ObjectId(),
      status: 'SCHEDULED',
      scheduledPostUsageCounted: true,
      save: mocks.save,
    } as any;

    mocks.findById.mockResolvedValue(post);
    mocks.findConnectedAccountById.mockResolvedValue({
      user: userId,
      provider: 'LINKEDIN',
      isActive: true,
      accessToken: 'encrypted-token',
    });
    mocks.getJob.mockResolvedValue({ remove });

    await expect(
      service.schedulePost({ _id: userId } as any, postId.toString(), {
        scheduledAt,
      } as any),
    ).rejects.toThrow('remove failed');
    expect(mocks.assertScheduledPostQuota).not.toHaveBeenCalled();
    expect(mocks.addScheduleJob).not.toHaveBeenCalled();
    expect(mocks.incrementScheduledPostUsage).not.toHaveBeenCalled();
  });

  it('still rejects scheduling for published posts', async () => {
    const { service, mocks } = createService();
    const userId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const scheduledAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const post = {
      _id: postId,
      user: userId,
      connectedAccount: new Types.ObjectId(),
      status: 'PUBLISHED',
      save: mocks.save,
    } as any;

    mocks.findById.mockResolvedValue(post);

    await expect(
      service.schedulePost({ _id: userId } as any, postId.toString(), {
        scheduledAt,
      } as any),
    ).rejects.toThrow('Post is already published');
    expect(mocks.assertScheduledPostQuota).not.toHaveBeenCalled();
    expect(mocks.addScheduleJob).not.toHaveBeenCalled();
    expect(mocks.incrementScheduledPostUsage).not.toHaveBeenCalled();
  });

  it('still rejects scheduling in the past', async () => {
    const { service, mocks } = createService();
    const userId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const scheduledAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const post = {
      _id: postId,
      user: userId,
      connectedAccount: new Types.ObjectId(),
      status: 'FAILED',
      scheduledPostUsageCounted: false,
      save: mocks.save,
    } as any;

    mocks.findById.mockResolvedValue(post);
    mocks.findConnectedAccountById.mockResolvedValue({
      user: userId,
      provider: 'LINKEDIN',
      isActive: true,
      accessToken: 'encrypted-token',
    });

    await expect(
      service.schedulePost({ _id: userId } as any, postId.toString(), {
        scheduledAt,
      } as any),
    ).rejects.toThrow('Scheduled time must be in the future');
    expect(mocks.assertScheduledPostQuota).not.toHaveBeenCalled();
    expect(mocks.addScheduleJob).not.toHaveBeenCalled();
    expect(mocks.incrementScheduledPostUsage).not.toHaveBeenCalled();
  });

  it('does not increment scheduling usage when queue enqueue fails', async () => {
    const { service, mocks } = createService();
    const userId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const scheduledAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const post = {
      _id: postId,
      user: userId,
      connectedAccount: new Types.ObjectId(),
      status: 'FAILED',
      scheduledPostUsageCounted: false,
      save: mocks.save,
    } as any;

    mocks.findById.mockResolvedValue(post);
    mocks.findConnectedAccountById.mockResolvedValue({
      user: userId,
      provider: 'LINKEDIN',
      isActive: true,
      accessToken: 'encrypted-token',
    });
    mocks.addScheduleJob.mockRejectedValue(new Error('queue unavailable'));

    await expect(
      service.schedulePost({ _id: userId } as any, postId.toString(), {
        scheduledAt,
      } as any),
    ).rejects.toThrow('queue unavailable');
    expect(mocks.assertScheduledPostQuota).toHaveBeenCalledWith(
      userId.toString(),
    );
    expect(mocks.incrementScheduledPostUsage).not.toHaveBeenCalled();
    expect(post.status).toBe('FAILED');
    expect(post.scheduledAt).toBeUndefined();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('should restore the previous queue job when rescheduling enqueue fails', async () => {
    const { service, mocks } = createService();
    const userId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const previousScheduledAt = new Date(Date.now() + 5 * 60 * 1000);
    const nextScheduledAt = new Date(Date.now() + 10 * 60 * 1000);
    const artifactId = new Types.ObjectId();
    const remove = jest.fn().mockResolvedValue(undefined);
    const post = {
      _id: postId,
      user: userId,
      connectedAccount: new Types.ObjectId(),
      artifacts: [{ artifact: artifactId, version: 1 }],
      status: 'SCHEDULED',
      scheduledAt: previousScheduledAt,
      scheduledPostUsageCounted: true,
      save: mocks.save,
    } as any;
    mocks.findById.mockResolvedValue(post);
    mocks.findConnectedAccountById.mockResolvedValue({
      user: userId,
      provider: 'LINKEDIN',
      isActive: true,
      accessToken: 'encrypted-token',
    });
    mocks.getJob.mockResolvedValue({ remove });
    mocks.addScheduleJob
      .mockRejectedValueOnce(new Error('queue unavailable'))
      .mockResolvedValueOnce(undefined);

    await expect(
      service.schedulePost({ _id: userId } as any, postId.toString(), {
        scheduledAt: nextScheduledAt.toISOString(),
      } as any),
    ).rejects.toThrow('queue unavailable');

    expect(remove).toHaveBeenCalledTimes(1);
    expect(mocks.updateArtifactPinRevision).toHaveBeenCalledWith(
      { _id: artifactId, currentVersion: 1 },
      { $inc: { pinRevision: 1 } },
    );
    expect(mocks.addScheduleJob).toHaveBeenCalledTimes(2);
    expect(mocks.addScheduleJob).toHaveBeenLastCalledWith(
      postId.toString(),
      userId.toString(),
      expect.any(Number),
    );
    expect(post.status).toBe('SCHEDULED');
    expect(post.scheduledAt).toEqual(previousScheduledAt);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});

describe('PostService artifact publishing', () => {
  const makeService = () => {
    const service = Object.create(PostService.prototype) as PostService;
    const userId = new Types.ObjectId();
    const artifactId = new Types.ObjectId();
    const accountId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const save = jest.fn().mockResolvedValue(undefined);
    const post = {
      _id: postId,
      user: userId,
      connectedAccount: accountId,
      artifacts: [{ artifact: artifactId, version: 1 }],
      status: 'SCHEDULED',
      save,
    } as any;
    const artifact = {
      _id: artifactId,
      user: userId,
      type: 'POST',
      title: 'Generated artifact title',
      source: { prompt: 'A source prompt' },
      currentVersion: 1,
      versions: [
        {
          version: 1,
          status: 'READY',
          content: { commentary: 'Approved text' },
        },
      ],
    } as any;
    const account = {
      _id: accountId,
      user: userId,
      provider: 'LINKEDIN',
      isActive: true,
      accessToken: 'encrypted',
      accountType: 'PERSON',
      externalId: 'person-1',
      profileMetadata: {},
    };
    const mocks = {
      postModel: jest
        .fn()
        .mockImplementation((values) => Object.assign(post, values)),
      findPostById: jest.fn().mockResolvedValue(post),
      findArtifactById: jest.fn().mockResolvedValue(artifact),
      updateArtifactPinRevision: jest
        .fn()
        .mockResolvedValue({ matchedCount: 1 }),
      findAccountById: jest.fn().mockResolvedValue(account),
      addScheduleJob: jest.fn().mockResolvedValue(undefined),
      getScheduleJob: jest.fn().mockResolvedValue(null),
      assertScheduledPostQuota: jest.fn().mockResolvedValue(undefined),
      incrementScheduledPostUsage: jest.fn().mockResolvedValue(undefined),
      hasScheduledPostUsage: jest.fn().mockResolvedValue(false),
      assertCompanyPagesAccess: jest.fn().mockResolvedValue(undefined),
      decrypt: jest.fn().mockResolvedValue('token'),
      uploadDocument: jest.fn().mockResolvedValue('urn:li:document:1'),
      getMediaDetails: jest.fn(),
    };
    Object.assign(service as any, {
      postModel: Object.assign(mocks.postModel, {
        findById: mocks.findPostById,
      }),
      artifactModel: {
        findById: mocks.findArtifactById,
        updateOne: mocks.updateArtifactPinRevision,
      },
      connectedAccountModel: { findById: mocks.findAccountById },
      scheduleQueue: {
        addScheduleJob: mocks.addScheduleJob,
        queue: { getJob: mocks.getScheduleJob },
      },
      featureGatingService: {
        assertScheduledPostQuota: mocks.assertScheduledPostQuota,
        incrementScheduledPostUsage: mocks.incrementScheduledPostUsage,
        hasScheduledPostUsage: mocks.hasScheduledPostUsage,
        assertCompanyPagesAccess: mocks.assertCompanyPagesAccess,
      },
      encryptionService: { decrypt: mocks.decrypt },
      linkedinMediaService: {
        uploadDocument: mocks.uploadDocument,
        getMediaDetails: mocks.getMediaDetails,
      },
      LINKEDIN_API_BASE: 'https://api.linkedin.com/rest',
      logger: { error: jest.fn() },
    });
    return {
      service,
      mocks,
      fixtures: { userId, artifactId, accountId, postId, post, artifact },
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (apiFetch as jest.Mock).mockResolvedValue({
      response: {
        headers: { get: jest.fn().mockReturnValue('urn:li:share:123') },
      },
    });
    (formatLinkedinContent as jest.Mock).mockImplementation(
      (value: string) => value,
    );
  });

  describe('createPost', () => {
    it('should create a mutable DRAFT with the selected READY artifact version', async () => {
      const { service, mocks, fixtures } = makeService();
      const result = await service.createPost({ _id: fixtures.userId } as any, {
        artifactId: fixtures.artifactId.toString(),
        connectedAccount: fixtures.accountId.toString(),
      });

      expect(mocks.postModel).toHaveBeenCalledWith(
        expect.objectContaining({
          artifacts: [{ artifact: fixtures.artifactId, version: 1 }],
          connectedAccount: fixtures.accountId,
          title: 'Generated artifact title',
          status: 'DRAFT',
        }),
      );
      expect(result).toBe(fixtures.post);
      expect(apiFetch).not.toHaveBeenCalled();
      expect(mocks.addScheduleJob).not.toHaveBeenCalled();
      expect(mocks.assertScheduledPostQuota).not.toHaveBeenCalled();
      expect(mocks.incrementScheduledPostUsage).not.toHaveBeenCalled();
    });

    it('should normalize and store the title when it is explicitly supplied', async () => {
      const { service, mocks, fixtures } = makeService();

      await service.createPost({ _id: fixtures.userId } as unknown as User, {
        artifactId: fixtures.artifactId.toString(),
        connectedAccount: fixtures.accountId.toString(),
        title: '  My post title  ',
      });

      expect(mocks.postModel).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'My post title' }),
      );
    });

    it('should fall back to a truncated source prompt when the artifact title is absent', async () => {
      const { service, mocks, fixtures } = makeService();
      fixtures.artifact.title = undefined;
      fixtures.artifact.source.prompt = `  ${'x'.repeat(120)}  `;

      await service.createPost({ _id: fixtures.userId } as unknown as User, {
        artifactId: fixtures.artifactId.toString(),
        connectedAccount: fixtures.accountId.toString(),
      });

      expect(mocks.postModel).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'x'.repeat(100) }),
      );
    });

    it('should reject a GENERATING artifact version', async () => {
      const { service, fixtures } = makeService();
      fixtures.artifact.versions[0].status = 'GENERATING';

      await expect(
        service.createPost({ _id: fixtures.userId } as any, {
          artifactId: fixtures.artifactId.toString(),
          connectedAccount: fixtures.accountId.toString(),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should reject an artifact owned by another user', async () => {
      const { service, fixtures } = makeService();
      fixtures.artifact.user = new Types.ObjectId();

      await expect(
        service.createPost({ _id: fixtures.userId } as any, {
          artifactId: fixtures.artifactId.toString(),
          connectedAccount: fixtures.accountId.toString(),
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('should reject scheduledAt because scheduling is an explicit action', async () => {
      const { service, fixtures } = makeService();
      const scheduledAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      await expect(
        service.createPost(
          { _id: fixtures.userId } as any,
          {
            artifactId: fixtures.artifactId.toString(),
            connectedAccount: fixtures.accountId.toString(),
            scheduledAt,
          } as any,
        ),
      ).rejects.toThrow('scheduledAt is not accepted when creating a draft');
    });
  });

  describe('publishPost', () => {
    it('should publish commentary from the pinned POST version without a content object', async () => {
      const { service, fixtures } = makeService();
      fixtures.post.title = 'Internal composer title';

      await service.publishPost(fixtures.postId.toString());

      const request = (apiFetch as jest.Mock).mock.calls[0][1];
      expect(JSON.parse(request.body)).toMatchObject({
        commentary: 'Approved text',
      });
      expect(JSON.parse(request.body).content).toBeUndefined();
      expect(JSON.parse(request.body).title).toBeUndefined();
      expect(fixtures.post.status).toBe('PUBLISHED');
    });

    it('should publish one READY image using its LinkedIn URN', async () => {
      const { service, fixtures } = makeService();
      fixtures.post.media = [
        {
          id: 'media-1',
          linkedinUrn: 'urn:li:image:1',
          type: 'IMAGE',
          title: 'Launch',
          altText: 'Product screenshot',
          status: 'READY',
        },
      ];

      await service.publishPost(fixtures.postId.toString());

      const body = JSON.parse((apiFetch as jest.Mock).mock.calls[0][1].body);
      expect(body.content).toEqual({
        media: {
          id: 'urn:li:image:1',
          title: 'Launch',
          altText: 'Product screenshot',
        },
      });
    });

    it('should block publishing when attached media has FAILED', async () => {
      const { service, fixtures } = makeService();
      fixtures.post.media = [
        { id: 'media-1', type: 'IMAGE', status: 'FAILED' },
      ];

      await expect(
        service.publishPost(fixtures.postId.toString()),
      ).rejects.toThrow('Media uploads must be resolved before publishing');
      expect(apiFetch).not.toHaveBeenCalled();
    });

    it('should publish inline poll content without uploading media when the artifact is a POLL', async () => {
      const { service, mocks, fixtures } = makeService();
      fixtures.artifact.type = 'POLL';
      fixtures.artifact.versions[0].content = {
        commentary: 'Choose one',
        poll: {
          question: 'Best day?',
          options: ['Monday', 'Friday'],
          durationDays: 7,
        },
      };

      await service.publishPost(fixtures.postId.toString());

      const body = JSON.parse((apiFetch as jest.Mock).mock.calls[0][1].body);
      expect(body.content).toEqual({
        poll: {
          question: 'Best day?',
          options: [{ text: 'Monday' }, { text: 'Friday' }],
          settings: {
            duration: 'SEVEN_DAYS',
            voteSelectionType: 'SINGLE_VOTE',
            isVoterVisibleToAuthor: true,
          },
        },
      });
      expect(mocks.uploadDocument).not.toHaveBeenCalled();
    });

    it('should send empty commentary when a poll has no framing text', async () => {
      const { service, fixtures } = makeService();
      fixtures.artifact.type = 'POLL';
      fixtures.artifact.versions[0].content = {
        poll: {
          question: 'Best day?',
          options: ['Monday', 'Friday'],
          durationDays: 7,
        },
      };

      await service.publishPost(fixtures.postId.toString());

      const body = JSON.parse((apiFetch as jest.Mock).mock.calls[0][1].body);
      expect(body.commentary).toBe('');
    });

    it('should upload pinned PDF bytes and publish the returned urn when the artifact is a DOCUMENT', async () => {
      const { service, mocks, fixtures } = makeService();
      const pdf = Buffer.from('rendered-pdf');
      fixtures.artifact.type = 'DOCUMENT';
      fixtures.artifact.versions[0].content = {
        commentary: 'Swipe through',
        document: {
          templateId: 'bold',
          slides: [
            { type: 'cover', fields: { title: 'First slide' } },
            { type: 'cta', fields: { headline: 'Go', action: 'Try it' } },
          ],
          pdfKey: 'artifacts/deck/1/document.pdf',
          pageCount: 8,
        },
      };
      (getFile as jest.Mock).mockResolvedValue(pdf);

      await service.publishPost(fixtures.postId.toString());

      expect(getFile).toHaveBeenCalledWith('artifacts/deck/1/document.pdf');
      expect(mocks.uploadDocument).toHaveBeenCalledWith(
        'urn:li:person:person-1',
        'token',
        pdf,
        8,
      );
      const postCall = (apiFetch as jest.Mock).mock.calls.at(-1);
      expect(JSON.parse(postCall[1].body).content).toEqual({
        media: { id: 'urn:li:document:1', title: 'First slide' },
      });
    });

    it('should send empty commentary when a document has no framing text', async () => {
      const { service, fixtures } = makeService();
      fixtures.artifact.type = 'DOCUMENT';
      fixtures.artifact.versions[0].content = {
        document: {
          templateId: 'bold',
          slides: [
            { type: 'cover', fields: { title: 'First slide' } },
            { type: 'cta', fields: { headline: 'Go', action: 'Try it' } },
          ],
          pdfKey: 'artifacts/deck/1/document.pdf',
          pageCount: 8,
        },
      };
      (getFile as jest.Mock).mockResolvedValue(Buffer.from('rendered-pdf'));

      await service.publishPost(fixtures.postId.toString());

      const postCall = (apiFetch as jest.Mock).mock.calls.at(-1);
      const body = JSON.parse(postCall[1].body);
      expect(body.commentary).toBe('');
    });

    it('should fail safely when the pinned version is unavailable', async () => {
      const { service, fixtures } = makeService();
      fixtures.artifact.versions = [];

      await expect(
        service.publishPost(fixtures.postId.toString()),
      ).rejects.toThrow('source artifact unavailable');
      expect(fixtures.post.status).toBe('FAILED');
      expect(fixtures.post.failureReason).toBe('source artifact unavailable');
      expect(apiFetch).not.toHaveBeenCalled();
    });

    it('should persist FAILED when account token decryption fails', async () => {
      const { service, mocks, fixtures } = makeService();
      mocks.decrypt.mockRejectedValue(new Error('decrypt failed'));

      await expect(
        service.publishPost(fixtures.postId.toString()),
      ).rejects.toThrow('Failed to publish post');
      expect(fixtures.post.status).toBe('FAILED');
      expect(fixtures.post.failureReason).toBe('Failed to publish post');
    });
  });

  describe('publishPostNow', () => {
    it('should publish an owned DRAFT without a schedule job', async () => {
      const { service, mocks, fixtures } = makeService();
      fixtures.post.status = 'DRAFT';

      const result = await service.publishPostNow(
        { _id: fixtures.userId } as any,
        fixtures.postId.toString(),
      );

      expect(mocks.getScheduleJob).toHaveBeenCalledWith(
        fixtures.postId.toString(),
      );
      expect(result.status).toBe('PUBLISHED');
    });

    it('should remove the pending job when publishing an owned SCHEDULED post', async () => {
      const { service, mocks, fixtures } = makeService();
      const remove = jest.fn().mockResolvedValue(undefined);
      mocks.getScheduleJob.mockResolvedValue({ remove });

      const result = await service.publishPostNow(
        { _id: fixtures.userId } as any,
        fixtures.postId.toString(),
      );

      expect(mocks.getScheduleJob).toHaveBeenCalledWith(
        fixtures.postId.toString(),
      );
      expect(remove).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('PUBLISHED');
    });

    it('should reject publish-now when the post belongs to another user', async () => {
      const { service, mocks, fixtures } = makeService();

      await expect(
        service.publishPostNow(
          { _id: new Types.ObjectId() } as any,
          fixtures.postId.toString(),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mocks.getScheduleJob).not.toHaveBeenCalled();
      expect(apiFetch).not.toHaveBeenCalled();
    });
  });

  describe('updatePost', () => {
    it('should update only the title when no replacement artifact is supplied', async () => {
      const { service, mocks, fixtures } = makeService();
      fixtures.post.status = 'DRAFT';
      mocks.findArtifactById.mockClear();

      await service.updatePost(
        { _id: fixtures.userId } as unknown as User,
        fixtures.postId.toString(),
        { title: '  Updated title  ' },
      );

      expect(fixtures.post.title).toBe('Updated title');
      expect(mocks.findArtifactById).not.toHaveBeenCalled();
      expect(fixtures.post.save).toHaveBeenCalledTimes(1);
    });

    it('should return a FAILED post to DRAFT when only the title changes', async () => {
      const { service, fixtures } = makeService();
      fixtures.post.status = 'FAILED';
      fixtures.post.failureReason = 'LinkedIn rejected the post';

      await service.updatePost(
        { _id: fixtures.userId } as unknown as User,
        fixtures.postId.toString(),
        { title: 'Retry title' },
      );

      expect(fixtures.post).toMatchObject({
        status: 'DRAFT',
        title: 'Retry title',
      });
      expect(fixtures.post.failureReason).toBeUndefined();
    });

    it('should preserve the post title when only the artifact changes', async () => {
      const { service, fixtures } = makeService();
      fixtures.post.status = 'DRAFT';
      fixtures.post.title = 'Composer title';

      await service.updatePost(
        { _id: fixtures.userId } as unknown as User,
        fixtures.postId.toString(),
        { artifactId: fixtures.artifactId.toString() },
      );

      expect(fixtures.post.title).toBe('Composer title');
    });

    it('should reject the patch when it is empty or has a version without an artifact', async () => {
      const { service, fixtures } = makeService();
      fixtures.post.status = 'DRAFT';

      await expect(
        service.updatePost(
          { _id: fixtures.userId } as unknown as User,
          fixtures.postId.toString(),
          {},
        ),
      ).rejects.toThrow('At least one post field must be provided');
      await expect(
        service.updatePost(
          { _id: fixtures.userId } as unknown as User,
          fixtures.postId.toString(),
          { version: 2 },
        ),
      ).rejects.toThrow('version requires artifactId');
    });

    it('should replace the selected artifact on an owned DRAFT', async () => {
      const { service, fixtures } = makeService();
      fixtures.post.status = 'DRAFT';

      const result = await service.updatePost(
        { _id: fixtures.userId } as any,
        fixtures.postId.toString(),
        { artifactId: fixtures.artifactId.toString(), version: 1 },
      );

      expect(result.artifacts).toEqual([
        { artifact: fixtures.artifactId, version: 1 },
      ]);
      expect(fixtures.post.save).toHaveBeenCalledTimes(1);
    });

    it('should return a FAILED post to DRAFT when its selection changes', async () => {
      const { service, fixtures } = makeService();
      fixtures.post.status = 'FAILED';
      fixtures.post.failureReason = 'LinkedIn rejected the post';
      fixtures.post.scheduledAt = new Date();

      await service.updatePost(
        { _id: fixtures.userId } as any,
        fixtures.postId.toString(),
        { artifactId: fixtures.artifactId.toString() },
      );

      expect(fixtures.post).toMatchObject({ status: 'DRAFT' });
      expect(fixtures.post.failureReason).toBeUndefined();
      expect(fixtures.post.scheduledAt).toBeUndefined();
    });

    it('should reject a non-POST artifact while uploaded media is attached', async () => {
      const { service, fixtures } = makeService();
      fixtures.post.status = 'DRAFT';
      fixtures.post.media = [{ id: 'media-1', type: 'IMAGE', status: 'READY' }];
      fixtures.artifact.type = 'POLL';

      await expect(
        service.updatePost(
          { _id: fixtures.userId } as any,
          fixtures.postId.toString(),
          { artifactId: fixtures.artifactId.toString() },
        ),
      ).rejects.toThrow(
        'Uploaded media can only be attached to POST artifacts',
      );
    });
  });

  describe('unschedulePost', () => {
    it('should remove the schedule job and return the post to DRAFT', async () => {
      const { service, mocks, fixtures } = makeService();
      const remove = jest.fn().mockResolvedValue(undefined);
      mocks.getScheduleJob.mockResolvedValue({ remove });
      fixtures.post.status = 'SCHEDULED';
      fixtures.post.scheduledAt = new Date();

      const result = await service.unschedulePost(
        { _id: fixtures.userId } as any,
        fixtures.postId.toString(),
      );

      expect(remove).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('DRAFT');
      expect(result.scheduledAt).toBeUndefined();
    });
  });
});

describe('PostService media composition', () => {
  const makeService = () => {
    const service = Object.create(PostService.prototype) as PostService;
    const userId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const artifactId = new Types.ObjectId();
    const accountId = new Types.ObjectId();
    const post = {
      _id: postId,
      user: userId,
      connectedAccount: accountId,
      artifacts: [{ artifact: artifactId, version: 1 }],
      status: 'DRAFT',
      media: [] as any[],
      save: jest.fn().mockResolvedValue(undefined),
      markModified: jest.fn(),
    } as any;
    const artifact = {
      _id: artifactId,
      user: userId,
      type: 'POST',
      currentVersion: 1,
      versions: [
        { version: 1, status: 'READY', content: { commentary: 'Text' } },
      ],
    } as any;
    const account = {
      _id: accountId,
      user: userId,
      provider: 'LINKEDIN',
      isActive: true,
      accessToken: 'encrypted',
      accountType: 'PERSON',
      externalId: 'person-1',
      profileMetadata: {},
    } as any;
    const addMediaUploadJob = jest.fn().mockResolvedValue(undefined);
    const getMediaDetails = jest.fn().mockResolvedValue({
      downloadUrl: 'https://media.linkedin.test/file',
      downloadUrlExpiresAt: 1234,
    });
    Object.assign(service as any, {
      postModel: { findById: jest.fn().mockResolvedValue(post) },
      artifactModel: { findById: jest.fn().mockResolvedValue(artifact) },
      connectedAccountModel: { findById: jest.fn().mockResolvedValue(account) },
      encryptionService: { decrypt: jest.fn().mockResolvedValue('token') },
      featureGatingService: { assertCompanyPagesAccess: jest.fn() },
      mediaUploadQueue: { addMediaUploadJob },
      linkedinMediaService: { getMediaDetails },
      MEDIA_UPLOAD_SLOT_TTL_MS: 30 * 60 * 1000,
    });
    return {
      service,
      mocks: { addMediaUploadJob, getMediaDetails },
      fixtures: { userId, postId, artifactId, accountId, post, artifact },
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getSignedUploadUrl as jest.Mock).mockResolvedValue(
      'https://r2.test/upload',
    );
    (headFile as jest.Mock).mockResolvedValue({
      sizeBytes: 1024,
      mimeType: 'image/jpeg',
    });
    (deleteFile as jest.Mock).mockResolvedValue(undefined);
  });

  describe('initiateMediaUpload', () => {
    it('should append stable PENDING media and return a presigned upload slot', async () => {
      const { service, fixtures } = makeService();

      const result = await service.initiateMediaUpload(
        { _id: fixtures.userId } as any,
        fixtures.postId.toString(),
        {
          files: [
            {
              fileName: 'launch.jpg',
              mimeType: 'image/jpeg',
              sizeBytes: 1024,
            },
          ],
        },
      );

      expect(result.uploads[0]).toMatchObject({
        mediaId: expect.any(String),
        uploadUrl: 'https://r2.test/upload',
      });
      expect(fixtures.post.media[0]).toMatchObject({
        id: result.uploads[0].mediaId,
        type: 'IMAGE',
        status: 'PENDING',
      });
    });
  });

  describe('completeMediaUpload', () => {
    it('should keep the media id stable and enqueue the LinkedIn transfer', async () => {
      const { service, mocks, fixtures } = makeService();
      fixtures.post.media = [
        {
          id: 'media-1',
          type: 'IMAGE',
          title: 'launch.jpg',
          altText: 'launch.jpg',
          status: 'PENDING',
          mimeType: 'image/jpeg',
          sizeBytes: 1024,
          pendingExpiresAt: new Date(Date.now() + 60_000),
        },
      ];

      await service.completeMediaUpload(
        { _id: fixtures.userId } as any,
        fixtures.postId.toString(),
        { mediaIds: ['media-1'] },
      );

      expect(fixtures.post.media[0]).toMatchObject({
        id: 'media-1',
        status: 'UPLOADING',
      });
      expect(mocks.addMediaUploadJob).toHaveBeenCalledWith({
        postId: fixtures.postId.toString(),
        connectedAccountId: fixtures.accountId.toString(),
        ownerUrn: 'urn:li:person:person-1',
        items: [
          {
            mediaId: 'media-1',
            r2Key: `media-uploads/${fixtures.postId.toString()}/media-1`,
            mediaType: 'IMAGE',
          },
        ],
      });
    });

    it('should mark media failed when the transfer job cannot be enqueued', async () => {
      const { service, mocks, fixtures } = makeService();
      fixtures.post.media = [
        {
          id: 'media-1',
          type: 'IMAGE',
          status: 'PENDING',
          mimeType: 'image/jpeg',
          sizeBytes: 1024,
          pendingExpiresAt: new Date(Date.now() + 60_000),
        },
      ];
      mocks.addMediaUploadJob.mockRejectedValue(new Error('queue unavailable'));

      await expect(
        service.completeMediaUpload(
          { _id: fixtures.userId } as any,
          fixtures.postId.toString(),
          { mediaIds: ['media-1'] },
        ),
      ).rejects.toThrow('queue unavailable');

      expect(fixtures.post.media[0].status).toBe('FAILED');
      expect(fixtures.post.save).toHaveBeenCalledTimes(2);
    });
  });

  describe('updateMedia', () => {
    it('should update image metadata without accepting lifecycle fields', async () => {
      const { service, fixtures } = makeService();
      fixtures.post.media = [{ id: 'media-1', type: 'IMAGE', status: 'READY' }];

      const result = await service.updateMedia(
        { _id: fixtures.userId } as any,
        fixtures.postId.toString(),
        'media-1',
        { title: 'Launch', altText: 'Dashboard preview' },
      );

      expect(result).toMatchObject({
        id: 'media-1',
        title: 'Launch',
        altText: 'Dashboard preview',
        status: 'READY',
      });
    });
  });

  describe('removeMedia', () => {
    it('should remove media by its stable id', async () => {
      const { service, fixtures } = makeService();
      fixtures.post.media = [
        { id: 'media-1', type: 'IMAGE', status: 'FAILED' },
      ];

      await expect(
        service.removeMedia(
          { _id: fixtures.userId } as any,
          fixtures.postId.toString(),
          'media-1',
        ),
      ).resolves.toEqual([]);
      expect(fixtures.post.media).toEqual([]);
    });
  });

  describe('getMediaPreview', () => {
    it('should resolve READY video through the post connected account', async () => {
      const { service, mocks, fixtures } = makeService();
      fixtures.post.media = [
        {
          id: 'media-1',
          linkedinUrn: 'urn:li:video:1',
          type: 'VIDEO',
          status: 'READY',
        },
      ];

      const result = await service.getMediaPreview(
        { _id: fixtures.userId } as any,
        fixtures.postId.toString(),
        'media-1',
      );

      expect(mocks.getMediaDetails).toHaveBeenCalledWith(
        'VIDEO',
        'urn:li:video:1',
        'token',
      );
      expect(result.downloadUrl).toBe('https://media.linkedin.test/file');
    });
  });
});

describe('PostService.deletePost', () => {
  const createService = () => {
    const service = Object.create(PostService.prototype) as PostService;
    const findById = jest.fn();
    const deleteExec = jest.fn().mockResolvedValue({ deletedCount: 1 });
    const deleteOne = jest.fn().mockReturnValue({ exec: deleteExec });
    const findConnectedAccountById = jest.fn();
    const decrypt = jest.fn().mockResolvedValue('token');
    const getJob = jest.fn();
    const decrementScheduledPostUsage = jest.fn();

    (service as any).postModel = {
      findById,
      deleteOne,
    };
    (service as any).connectedAccountModel = {
      findById: findConnectedAccountById,
    };
    (service as any).encryptionService = {
      decrypt,
    };
    (service as any).scheduleQueue = {
      queue: {
        getJob,
      },
    };
    (service as any).featureGatingService = {
      decrementScheduledPostUsage,
    };
    (service as any).LINKEDIN_API_BASE = 'https://api.linkedin.com/rest';

    return {
      service,
      mocks: {
        findById,
        deleteOne,
        deleteExec,
        findConnectedAccountById,
        decrypt,
        getJob,
        decrementScheduledPostUsage,
      },
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('removes scheduled queue job before deleting the post when job exists', async () => {
    const { service, mocks } = createService();
    const userId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const remove = jest.fn().mockResolvedValue(undefined);
    const post = {
      _id: postId,
      user: userId,
      connectedAccount: new Types.ObjectId(),
      status: 'SCHEDULED',
    } as any;

    mocks.findById.mockResolvedValue(post);
    mocks.findConnectedAccountById.mockResolvedValue({
      user: userId,
      provider: 'LINKEDIN',
      isActive: true,
      accessToken: 'encrypted-token',
    });
    mocks.getJob.mockResolvedValue({ remove });

    await service.deletePost({ _id: userId } as any, postId.toString());

    expect(mocks.getJob).toHaveBeenCalledWith(postId.toString());
    expect(remove).toHaveBeenCalledTimes(1);
    expect(mocks.deleteOne).toHaveBeenCalledTimes(1);
    expect(mocks.decrementScheduledPostUsage).not.toHaveBeenCalled();
    const deleteArg = mocks.deleteOne.mock.calls[0][0];
    expect(deleteArg._id.toString()).toBe(postId.toString());
  });

  it('deletes scheduled post when queue job is already missing', async () => {
    const { service, mocks } = createService();
    const userId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const post = {
      _id: postId,
      user: userId,
      connectedAccount: new Types.ObjectId(),
      status: 'SCHEDULED',
    } as any;

    mocks.findById.mockResolvedValue(post);
    mocks.findConnectedAccountById.mockResolvedValue({
      user: userId,
      provider: 'LINKEDIN',
      isActive: true,
      accessToken: 'encrypted-token',
    });
    mocks.getJob.mockResolvedValue(null);

    await service.deletePost({ _id: userId } as any, postId.toString());

    expect(mocks.getJob).toHaveBeenCalledWith(postId.toString());
    expect(mocks.deleteOne).toHaveBeenCalledTimes(1);
  });

  it('fails deletion if scheduled queue job removal throws', async () => {
    const { service, mocks } = createService();
    const userId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const remove = jest.fn().mockRejectedValue(new Error('remove failed'));
    const post = {
      _id: postId,
      user: userId,
      connectedAccount: new Types.ObjectId(),
      status: 'SCHEDULED',
    } as any;

    mocks.findById.mockResolvedValue(post);
    mocks.findConnectedAccountById.mockResolvedValue({
      user: userId,
      provider: 'LINKEDIN',
      isActive: true,
      accessToken: 'encrypted-token',
    });
    mocks.getJob.mockResolvedValue({ remove });

    await expect(
      service.deletePost({ _id: userId } as any, postId.toString()),
    ).rejects.toThrow('remove failed');
    expect(mocks.deleteOne).not.toHaveBeenCalled();
  });

  it('should avoid queue lookup when deleting a FAILED post', async () => {
    const { service, mocks } = createService();
    const userId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const post = {
      _id: postId,
      user: userId,
      connectedAccount: new Types.ObjectId(),
      status: 'FAILED',
    } as any;

    mocks.findById.mockResolvedValue(post);
    mocks.findConnectedAccountById.mockResolvedValue({
      user: userId,
      provider: 'LINKEDIN',
      isActive: true,
      accessToken: 'encrypted-token',
    });

    await service.deletePost({ _id: userId } as any, postId.toString());

    expect(mocks.getJob).not.toHaveBeenCalled();
    expect(mocks.deleteOne).toHaveBeenCalledTimes(1);
  });

  it('should delete the LinkedIn post when deleting a published record', async () => {
    const { service, mocks } = createService();
    const userId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const post = {
      _id: postId,
      user: userId,
      connectedAccount: new Types.ObjectId(),
      status: 'PUBLISHED',
      channelPostId: 'urn:li:share:123',
    } as any;
    const mockedApiFetch = apiFetch as jest.Mock;
    mockedApiFetch.mockResolvedValue({ data: {}, response: {} });

    mocks.findById.mockResolvedValue(post);
    mocks.findConnectedAccountById.mockResolvedValue({
      user: userId,
      provider: 'LINKEDIN',
      isActive: true,
      accessToken: 'encrypted-token',
    });

    await service.deletePost({ _id: userId } as any, postId.toString());

    expect(mocks.getJob).not.toHaveBeenCalled();
    expect(mockedApiFetch).toHaveBeenCalledTimes(1);
    expect(mocks.deleteOne).toHaveBeenCalledTimes(1);
  });

  it('should block deletion when a published post account is disconnected', async () => {
    const { service, mocks } = createService();
    const userId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const post = {
      _id: postId,
      user: userId,
      connectedAccount: new Types.ObjectId(),
      status: 'PUBLISHED',
      channelPostId: 'urn:li:share:123',
    } as any;

    mocks.findById.mockResolvedValue(post);
    mocks.findConnectedAccountById.mockResolvedValue({
      user: userId,
      provider: 'LINKEDIN',
      isActive: false,
      accessToken: null,
    });

    await expect(
      service.deletePost({ _id: userId } as any, postId.toString()),
    ).rejects.toThrow(
      'Reconnect account to delete published posts from LinkedIn safely.',
    );
    expect(mocks.deleteOne).not.toHaveBeenCalled();
  });
});
