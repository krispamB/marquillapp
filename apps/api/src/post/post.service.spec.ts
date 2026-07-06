import { Types } from 'mongoose';

jest.mock(
  'src/database/schemas',
  () => ({
    AccountProvider: { LINKEDIN: 'LINKEDIN' },
    LinkedinAccountType: { PERSON: 'PERSON', ORGANIZATION: 'ORGANIZATION' },
    ConnectedAccount: { name: 'ConnectedAccount' },
    PostDraft: { name: 'PostDraft' },
    PostDraftStatus: {
      DRAFT: 'DRAFT',
      SCHEDULED: 'SCHEDULED',
      PUBLISHED: 'PUBLISHED',
    },
    User: { name: 'User' },
  }),
  { virtual: true },
);
jest.mock(
  'src/common/HelperFn/apiFetch.helper',
  () => ({ apiFetch: jest.fn() }),
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
    uploadFile: jest.fn(),
    deleteFile: jest.fn(),
  }),
  { virtual: true },
);
jest.mock('fs/promises', () => ({
  readFile: jest.fn().mockResolvedValue(Buffer.from('file-bytes')),
  unlink: jest.fn().mockResolvedValue(undefined),
}));

import { PostService } from './post.service';
import { deleteFile, uploadFile } from 'src/s3';
import { unlink } from 'fs/promises';
import { apiFetch } from 'src/common/HelperFn/apiFetch.helper';
import { formatLinkedinContent } from 'src/common/HelperFn';

describe('PostService.getPosts', () => {
  const createService = () => {
    const service = Object.create(PostService.prototype) as PostService;

    const exec = jest.fn();
    const lean = jest.fn().mockReturnValue({ exec });
    const sort = jest.fn().mockReturnValue({ lean });
    const select = jest.fn().mockReturnValue({ sort });
    const find = jest.fn().mockReturnValue({ select });
    const aggregate = jest.fn();
    const distinct = jest.fn();

    (service as any).postDraftModel = {
      find,
      aggregate,
      distinct,
    };

    return {
      service,
      mocks: {
        find,
        select,
        sort,
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

    const posts = [{ _id: new Types.ObjectId(), content: 'post 1' }] as any[];
    mocks.exec.mockResolvedValue(posts);
    mocks.aggregate.mockResolvedValue([
      { month: '2026-02' },
      { month: '2026-01' },
    ]);
    mocks.distinct.mockResolvedValue([connectedAccountId]);

    const result = await service.getPosts(
      { _id: userId } as any,
      connectedAccountId.toString(),
      'DRAFT',
      '2026-01',
    );

    expect(mocks.find).toHaveBeenCalledTimes(1);
    expect(mocks.select).toHaveBeenCalledWith('-userIntent -compressionResult');
    expect(mocks.lean).toHaveBeenCalledTimes(1);
    const filter = mocks.find.mock.calls[0][0];
    expect(filter.user).toEqual(userId);
    expect(filter.status).toBe('DRAFT');
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

describe('PostService.createDraft', () => {
  it('checks AI draft quota and increments usage after successful creation', async () => {
    const service = Object.create(PostService.prototype) as PostService;
    const userId = new Types.ObjectId();
    const save = jest.fn().mockResolvedValue(undefined);
    const draftId = new Types.ObjectId();
    const postDraftModel = jest.fn().mockImplementation(() => ({
      _id: draftId,
      save,
    }));
    const addWorkflowJob = jest.fn().mockResolvedValue(undefined);
    const assertAiDraftQuota = jest.fn().mockResolvedValue(undefined);
    const incrementAiDraftUsage = jest.fn().mockResolvedValue(undefined);
    const connectedAccountFindById = jest.fn().mockResolvedValue({
      user: userId,
      provider: 'LINKEDIN',
    });

    (service as any).postDraftModel = postDraftModel;
    (service as any).connectedAccountModel = {
      findById: connectedAccountFindById,
    };
    (service as any).workflowQueue = { addWorkflowJob };
    (service as any).featureGatingService = {
      assertAiDraftQuota,
      incrementAiDraftUsage,
    };

    const user = { _id: userId } as any;
    const accountId = new Types.ObjectId().toString();
    const dto = {
      input: 'test prompt',
      contentType: 'quickPostLinkedin',
    } as any;

    const workflowId = await service.createDraft(user, accountId, dto);

    expect(assertAiDraftQuota).toHaveBeenCalledWith(user._id.toString());
    expect(addWorkflowJob).toHaveBeenCalledWith(workflowId, {
      workflowName: dto.contentType,
      input: dto,
    });
    expect(incrementAiDraftUsage).toHaveBeenCalledWith(user._id.toString());
    expect(save).toHaveBeenCalled();
  });

  it('does not increment usage when draft creation workflow enqueue fails', async () => {
    const service = Object.create(PostService.prototype) as PostService;
    const save = jest.fn().mockResolvedValue(undefined);
    const draftId = new Types.ObjectId();
    const postDraftModel = jest.fn().mockImplementation(() => ({
      _id: draftId,
      save,
    }));
    const addWorkflowJob = jest
      .fn()
      .mockRejectedValue(new Error('queue unavailable'));
    const assertAiDraftQuota = jest.fn().mockResolvedValue(undefined);
    const incrementAiDraftUsage = jest.fn().mockResolvedValue(undefined);
    const userId = new Types.ObjectId();
    const connectedAccountFindById = jest.fn().mockResolvedValue({
      user: userId,
      provider: 'LINKEDIN',
    });

    (service as any).postDraftModel = postDraftModel;
    (service as any).connectedAccountModel = {
      findById: connectedAccountFindById,
    };
    (service as any).workflowQueue = { addWorkflowJob };
    (service as any).featureGatingService = {
      assertAiDraftQuota,
      incrementAiDraftUsage,
    };

    const user = { _id: userId } as any;
    const accountId = new Types.ObjectId().toString();
    const dto = {
      input: 'test prompt',
      contentType: 'quickPostLinkedin',
    } as any;

    await expect(service.createDraft(user, accountId, dto)).rejects.toThrow(
      'queue unavailable',
    );
    expect(incrementAiDraftUsage).not.toHaveBeenCalled();
  });

  it('persists provided style preset on draft creation', async () => {
    const service = Object.create(PostService.prototype) as PostService;
    const userId = new Types.ObjectId();
    const draftId = new Types.ObjectId();
    const save = jest.fn().mockResolvedValue(undefined);
    const postDraftModel = jest.fn().mockImplementation(() => ({
      _id: draftId,
      save,
    }));
    const addWorkflowJob = jest.fn().mockResolvedValue(undefined);
    const assertAiDraftQuota = jest.fn().mockResolvedValue(undefined);
    const incrementAiDraftUsage = jest.fn().mockResolvedValue(undefined);
    const connectedAccountFindById = jest.fn().mockResolvedValue({
      user: userId,
      provider: 'LINKEDIN',
    });

    (service as any).postDraftModel = postDraftModel;
    (service as any).connectedAccountModel = {
      findById: connectedAccountFindById,
    };
    (service as any).workflowQueue = { addWorkflowJob };
    (service as any).featureGatingService = {
      assertAiDraftQuota,
      incrementAiDraftUsage,
    };

    const user = { _id: userId } as any;
    const accountId = new Types.ObjectId().toString();
    const dto = {
      input: 'test prompt',
      contentType: 'quickPostLinkedin',
      stylePreset: 'storytelling',
    } as any;

    await service.createDraft(user, accountId, dto);

    expect(postDraftModel).toHaveBeenCalledWith(
      expect.objectContaining({
        stylePreset: 'storytelling',
      }),
    );
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

    (service as any).postDraftModel = {
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
      },
    };
  };

  it('schedules a draft post without attempting to remove an existing queue job', async () => {
    const { service, mocks } = createService();
    const userId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const scheduledTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const post = {
      _id: postId,
      user: userId,
      connectedAccount: new Types.ObjectId(),
      status: 'DRAFT',
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
      { scheduledTime } as any,
    );

    expect(mocks.getJob).not.toHaveBeenCalled();
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
    );
    expect(post.status).toBe('SCHEDULED');
    expect(post.scheduledAt).toEqual(new Date(scheduledTime));
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(result).toBe(post);
  });

  it('reschedules a scheduled post by removing the existing job first', async () => {
    const { service, mocks } = createService();
    const userId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const scheduledTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const remove = jest.fn().mockResolvedValue(undefined);
    const post = {
      _id: postId,
      user: userId,
      connectedAccount: new Types.ObjectId(),
      status: 'SCHEDULED',
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
      scheduledTime,
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
    expect(post.scheduledAt).toEqual(new Date(scheduledTime));
  });

  it('reschedules even when the old scheduled job is already missing', async () => {
    const { service, mocks } = createService();
    const userId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const scheduledTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const post = {
      _id: postId,
      user: userId,
      connectedAccount: new Types.ObjectId(),
      status: 'SCHEDULED',
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
      scheduledTime,
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
    const scheduledTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const remove = jest.fn().mockRejectedValue(new Error('remove failed'));
    const post = {
      _id: postId,
      user: userId,
      connectedAccount: new Types.ObjectId(),
      status: 'SCHEDULED',
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
        scheduledTime,
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
    const scheduledTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();
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
        scheduledTime,
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
    const scheduledTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const post = {
      _id: postId,
      user: userId,
      connectedAccount: new Types.ObjectId(),
      status: 'DRAFT',
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
        scheduledTime,
      } as any),
    ).rejects.toThrow('Scheduled time must be in the future');
    expect(mocks.assertScheduledPostQuota).toHaveBeenCalledWith(
      userId.toString(),
    );
    expect(mocks.addScheduleJob).not.toHaveBeenCalled();
    expect(mocks.incrementScheduledPostUsage).not.toHaveBeenCalled();
  });

  it('does not increment scheduling usage when queue enqueue fails', async () => {
    const { service, mocks } = createService();
    const userId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const scheduledTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const post = {
      _id: postId,
      user: userId,
      connectedAccount: new Types.ObjectId(),
      status: 'DRAFT',
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
        scheduledTime,
      } as any),
    ).rejects.toThrow('queue unavailable');
    expect(mocks.assertScheduledPostQuota).toHaveBeenCalledWith(
      userId.toString(),
    );
    expect(mocks.incrementScheduledPostUsage).not.toHaveBeenCalled();
  });
});

describe('PostService.publishOnLinkedIn', () => {
  const createService = () => {
    const service = Object.create(PostService.prototype) as PostService;
    const findById = jest.fn();
    const save = jest.fn().mockResolvedValue(undefined);
    const findConnectedAccountById = jest.fn().mockResolvedValue({
      user: new Types.ObjectId(),
      provider: 'LINKEDIN',
      isActive: true,
      accessToken: 'encrypted-token',
      accountType: 'PERSON',
      impersonatorUrn: 'urn:li:person:abc',
      profileMetadata: {},
    });
    const decrypt = jest.fn().mockResolvedValue('token');
    const mockedApiFetch = apiFetch as jest.Mock;

    mockedApiFetch.mockResolvedValue({
      response: {
        headers: {
          get: jest.fn().mockReturnValue('urn:li:share:123'),
        },
      },
    });
    (formatLinkedinContent as jest.Mock).mockImplementation(
      (text: string) => text,
    );

    (service as any).postDraftModel = {
      findById,
    };
    (service as any).connectedAccountModel = {
      findById: findConnectedAccountById,
    };
    (service as any).encryptionService = {
      decrypt,
    };
    (service as any).LINKEDIN_API_BASE = 'https://api.linkedin.com/rest';

    return {
      service,
      mocks: {
        findById,
        save,
        findConnectedAccountById,
        decrypt,
        mockedApiFetch,
      },
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('publishes successfully when media is an empty array', async () => {
    const { service, mocks } = createService();
    const userId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const post = {
      _id: postId,
      user: userId,
      connectedAccount: new Types.ObjectId(),
      status: 'SCHEDULED',
      content: 'text only',
      media: [],
      save: mocks.save,
    } as any;
    mocks.findById.mockResolvedValue(post);
    mocks.findConnectedAccountById.mockResolvedValue({
      user: userId,
      provider: 'LINKEDIN',
      isActive: true,
      accessToken: 'encrypted-token',
      accountType: 'PERSON',
      impersonatorUrn: 'urn:li:person:abc',
      profileMetadata: {},
    });

    await expect(
      service.publishOnLinkedIn({ _id: userId } as any, postId.toString()),
    ).resolves.toBeUndefined();

    expect(mocks.mockedApiFetch).toHaveBeenCalledTimes(1);
    const request = mocks.mockedApiFetch.mock.calls[0][1];
    const body = JSON.parse(request.body);
    expect(body.content).toBeUndefined();
    expect(body.commentary).toBe('text only');
    expect(post.status).toBe('PUBLISHED');
  });

  it('publishes successfully when media is undefined', async () => {
    const { service, mocks } = createService();
    const userId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const post = {
      _id: postId,
      user: userId,
      connectedAccount: new Types.ObjectId(),
      status: 'SCHEDULED',
      content: 'text only',
      save: mocks.save,
    } as any;
    mocks.findById.mockResolvedValue(post);
    mocks.findConnectedAccountById.mockResolvedValue({
      user: userId,
      provider: 'LINKEDIN',
      isActive: true,
      accessToken: 'encrypted-token',
      accountType: 'PERSON',
      impersonatorUrn: 'urn:li:person:abc',
      profileMetadata: {},
    });

    await expect(
      service.publishOnLinkedIn({ _id: userId } as any, postId.toString()),
    ).resolves.toBeUndefined();

    expect(mocks.mockedApiFetch).toHaveBeenCalledTimes(1);
    const request = mocks.mockedApiFetch.mock.calls[0][1];
    const body = JSON.parse(request.body);
    expect(body.content).toBeUndefined();
    expect(body.commentary).toBe('text only');
  });

  it('should reject publishing when media uploads are still in progress', async () => {
    const { service, mocks } = createService();
    const userId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const post = {
      _id: postId,
      user: userId,
      connectedAccount: new Types.ObjectId(),
      status: 'DRAFT',
      content: 'with media',
      media: [{ id: 'media-1', type: 'IMAGE', status: 'UPLOADING' }],
      save: mocks.save,
    } as any;
    mocks.findById.mockResolvedValue(post);
    mocks.findConnectedAccountById.mockResolvedValue({
      user: userId,
      provider: 'LINKEDIN',
      isActive: true,
      accessToken: 'encrypted-token',
      accountType: 'PERSON',
      impersonatorUrn: 'urn:li:person:abc',
      profileMetadata: {},
    });

    await expect(
      service.publishOnLinkedIn({ _id: userId } as any, postId.toString()),
    ).rejects.toThrow('Media uploads are still in progress');
    expect(mocks.mockedApiFetch).not.toHaveBeenCalled();
  });

  it('should exclude failed media from the publish payload', async () => {
    const { service, mocks } = createService();
    const userId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const post = {
      _id: postId,
      user: userId,
      connectedAccount: new Types.ObjectId(),
      status: 'DRAFT',
      content: 'with media',
      media: [
        { id: 'urn:li:image:1', title: 'ok', type: 'IMAGE', status: 'READY' },
        { id: 'media-2', title: 'broken', type: 'IMAGE', status: 'FAILED' },
      ],
      save: mocks.save,
    } as any;
    mocks.findById.mockResolvedValue(post);
    mocks.findConnectedAccountById.mockResolvedValue({
      user: userId,
      provider: 'LINKEDIN',
      isActive: true,
      accessToken: 'encrypted-token',
      accountType: 'PERSON',
      impersonatorUrn: 'urn:li:person:abc',
      profileMetadata: {},
    });

    await service.publishOnLinkedIn({ _id: userId } as any, postId.toString());

    const request = mocks.mockedApiFetch.mock.calls[0][1];
    const body = JSON.parse(request.body);
    expect(body.content).toEqual({
      media: {
        id: 'urn:li:image:1',
        title: 'ok',
      },
    });
  });

  it('includes media payload when media exists', async () => {
    const { service, mocks } = createService();
    const userId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const post = {
      _id: postId,
      user: userId,
      connectedAccount: new Types.ObjectId(),
      status: 'SCHEDULED',
      content: 'with media',
      media: [{ id: 'urn:li:image:1', title: 'image-1', type: 'IMAGE' }],
      save: mocks.save,
    } as any;
    mocks.findById.mockResolvedValue(post);
    mocks.findConnectedAccountById.mockResolvedValue({
      user: userId,
      provider: 'LINKEDIN',
      isActive: true,
      accessToken: 'encrypted-token',
      accountType: 'PERSON',
      impersonatorUrn: 'urn:li:person:abc',
      profileMetadata: {},
    });

    await service.publishOnLinkedIn({ _id: userId } as any, postId.toString());

    const request = mocks.mockedApiFetch.mock.calls[0][1];
    const body = JSON.parse(request.body);
    expect(body.content).toEqual({
      media: {
        id: 'urn:li:image:1',
        title: 'image-1',
      },
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

    (service as any).postDraftModel = {
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

  it('keeps non-scheduled delete behavior unchanged', async () => {
    const { service, mocks } = createService();
    const userId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const post = {
      _id: postId,
      user: userId,
      connectedAccount: new Types.ObjectId(),
      status: 'DRAFT',
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

  it('still calls LinkedIn delete for published posts', async () => {
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

  it('blocks deleting published posts when account is disconnected', async () => {
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

describe('PostService.addLinkedinMedia', () => {
  const createService = () => {
    const service = Object.create(PostService.prototype) as PostService;
    const findById = jest.fn();
    const save = jest.fn().mockResolvedValue(undefined);
    const findConnectedAccountById = jest.fn();
    const addMediaUploadJob = jest.fn().mockResolvedValue(undefined);

    (service as any).postDraftModel = { findById };
    (service as any).connectedAccountModel = {
      findById: findConnectedAccountById,
    };
    (service as any).mediaUploadQueue = { addMediaUploadJob };

    const userId = new Types.ObjectId();
    const postId = new Types.ObjectId();
    const connectedAccountId = new Types.ObjectId();
    const post = {
      _id: postId,
      user: userId,
      connectedAccount: connectedAccountId,
      status: 'DRAFT',
      media: [],
      save,
    } as any;
    const connectedAccount = {
      user: userId,
      provider: 'LINKEDIN',
      isActive: true,
      accessToken: 'encrypted-token',
      accountType: 'PERSON',
      profileMetadata: { sub: 'abc' },
    };

    return {
      service,
      mocks: { findById, save, findConnectedAccountById, addMediaUploadJob },
      fixtures: { userId, postId, connectedAccountId, post, connectedAccount },
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const imageFile = (name: string) =>
    ({
      path: `/tmp/${name}`,
      mimetype: 'image/jpeg',
      originalname: name,
    }) as any;

  it('should upload files to R2, append UPLOADING media, and enqueue a job when files are valid', async () => {
    const { service, mocks, fixtures } = createService();
    mocks.findById.mockResolvedValue(fixtures.post);
    mocks.findConnectedAccountById.mockResolvedValue(fixtures.connectedAccount);
    (uploadFile as jest.Mock).mockResolvedValue('https://r2/url');

    const result = await service.addLinkedinMedia(
      { _id: fixtures.userId } as any,
      fixtures.postId.toString(),
      [imageFile('a.jpg')],
    );

    expect(uploadFile).toHaveBeenCalledTimes(1);
    const [r2Key, body, mimeType] = (uploadFile as jest.Mock).mock.calls[0];
    expect(r2Key).toMatch(
      new RegExp(`^media-uploads/${fixtures.postId.toString()}/`),
    );
    expect(body).toEqual(Buffer.from('file-bytes'));
    expect(mimeType).toBe('image/jpeg');

    expect(mocks.addMediaUploadJob).toHaveBeenCalledWith({
      postId: fixtures.postId.toString(),
      connectedAccountId: fixtures.connectedAccountId.toString(),
      ownerUrn: 'urn:li:person:abc',
      items: [expect.objectContaining({ r2Key, mediaType: 'IMAGE' })],
    });

    expect(fixtures.post.media).toHaveLength(1);
    expect(fixtures.post.media[0]).toMatchObject({
      type: 'IMAGE',
      title: 'a.jpg',
      status: 'UPLOADING',
    });
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(unlink).toHaveBeenCalledWith('/tmp/a.jpg');
    expect(result).toEqual(fixtures.post.media);
  });

  it('should reject when a media upload is already in progress', async () => {
    const { service, mocks, fixtures } = createService();
    fixtures.post.media = [
      { id: 'media-1', type: 'IMAGE', status: 'UPLOADING' },
    ];
    mocks.findById.mockResolvedValue(fixtures.post);

    await expect(
      service.addLinkedinMedia(
        { _id: fixtures.userId } as any,
        fixtures.postId.toString(),
        [imageFile('a.jpg')],
      ),
    ).rejects.toThrow('A media upload is already in progress for this post');
    expect(uploadFile).not.toHaveBeenCalled();
    expect(mocks.addMediaUploadJob).not.toHaveBeenCalled();
  });

  it('should reject when images and videos are mixed', async () => {
    const { service, mocks, fixtures } = createService();
    mocks.findById.mockResolvedValue(fixtures.post);

    await expect(
      service.addLinkedinMedia(
        { _id: fixtures.userId } as any,
        fixtures.postId.toString(),
        [
          imageFile('a.jpg'),
          {
            path: '/tmp/b.mp4',
            mimetype: 'video/mp4',
            originalname: 'b.mp4',
          } as any,
        ],
      ),
    ).rejects.toThrow('Cannot mix images and videos in one post');
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('should delete already-uploaded R2 objects when a later upload fails', async () => {
    const { service, mocks, fixtures } = createService();
    mocks.findById.mockResolvedValue(fixtures.post);
    mocks.findConnectedAccountById.mockResolvedValue(fixtures.connectedAccount);
    (uploadFile as jest.Mock)
      .mockResolvedValueOnce('https://r2/url')
      .mockRejectedValueOnce(new Error('R2 unavailable'));

    await expect(
      service.addLinkedinMedia(
        { _id: fixtures.userId } as any,
        fixtures.postId.toString(),
        [imageFile('a.jpg'), imageFile('b.jpg')],
      ),
    ).rejects.toThrow('R2 unavailable');

    const firstKey = (uploadFile as jest.Mock).mock.calls[0][0];
    expect(deleteFile).toHaveBeenCalledWith(firstKey);
    expect(mocks.addMediaUploadJob).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
