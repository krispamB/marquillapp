import { Types } from 'mongoose';

jest.mock(
  'src/database/schemas',
  () => ({
    AccountProvider: { LINKEDIN: 'LINKEDIN' },
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
jest.mock(
  'src/common/HelperFn',
  () => ({ formatLinkedinContent: jest.fn() }),
  { virtual: true },
);
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

import { PostService } from './post.service';
import { apiFetch } from 'src/common/HelperFn/apiFetch.helper';

describe('PostService.getPosts', () => {
  const createService = () => {
    const service = Object.create(PostService.prototype) as PostService;

    const exec = jest.fn();
    const sort = jest.fn().mockReturnValue({ exec });
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
    mocks.aggregate.mockResolvedValue([{ month: '2026-02' }, { month: '2026-01' }]);
    mocks.distinct.mockResolvedValue([connectedAccountId]);

    const result = await service.getPosts(
      { _id: userId } as any,
      connectedAccountId.toString(),
      'DRAFT',
      '2026-01',
    );

    expect(mocks.find).toHaveBeenCalledTimes(1);
    const filter = mocks.find.mock.calls[0][0];
    expect(filter.user).toEqual(userId);
    expect(filter.status).toBe('DRAFT');
    expect(filter.connectedAccount).toEqual(connectedAccountId);
    expect(filter.createdAt.$gte).toEqual(new Date(2026, 0, 1));
    expect(filter.createdAt.$lt).toEqual(new Date(2026, 1, 1));

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
    const save = jest.fn().mockResolvedValue(undefined);
    const draftId = new Types.ObjectId();
    const postDraftModel = jest.fn().mockImplementation(() => ({
      _id: draftId,
      save,
    }));
    const addWorkflowJob = jest.fn().mockResolvedValue(undefined);
    const assertAiDraftQuota = jest.fn().mockResolvedValue(undefined);
    const incrementAiDraftUsage = jest.fn().mockResolvedValue(undefined);

    (service as any).postDraftModel = postDraftModel;
    (service as any).workflowQueue = { addWorkflowJob };
    (service as any).featureGatingService = {
      assertAiDraftQuota,
      incrementAiDraftUsage,
    };

    const user = { _id: new Types.ObjectId() } as any;
    const accountId = new Types.ObjectId().toString();
    const dto = { input: 'test prompt', contentType: 'quickPostLinkedin' } as any;

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

    (service as any).postDraftModel = postDraftModel;
    (service as any).workflowQueue = { addWorkflowJob };
    (service as any).featureGatingService = {
      assertAiDraftQuota,
      incrementAiDraftUsage,
    };

    const user = { _id: new Types.ObjectId() } as any;
    const accountId = new Types.ObjectId().toString();
    const dto = { input: 'test prompt', contentType: 'quickPostLinkedin' } as any;

    await expect(service.createDraft(user, accountId, dto)).rejects.toThrow(
      'queue unavailable',
    );
    expect(incrementAiDraftUsage).not.toHaveBeenCalled();
  });
});

describe('PostService.deletePost', () => {
  const createService = () => {
    const service = Object.create(PostService.prototype) as PostService;
    const findById = jest.fn();
    const deleteExec = jest.fn().mockResolvedValue({ deletedCount: 1 });
    const deleteOne = jest.fn().mockReturnValue({ exec: deleteExec });
    const findOne = jest.fn();
    const decrypt = jest.fn().mockResolvedValue('token');
    const getJob = jest.fn();

    (service as any).postDraftModel = {
      findById,
      deleteOne,
    };
    (service as any).connectedAccountModel = {
      findOne,
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
        findOne,
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
      status: 'SCHEDULED',
    } as any;

    mocks.findById.mockResolvedValue(post);
    mocks.findOne.mockResolvedValue({
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
      status: 'SCHEDULED',
    } as any;

    mocks.findById.mockResolvedValue(post);
    mocks.findOne.mockResolvedValue({
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
      status: 'SCHEDULED',
    } as any;

    mocks.findById.mockResolvedValue(post);
    mocks.findOne.mockResolvedValue({
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
      status: 'DRAFT',
    } as any;

    mocks.findById.mockResolvedValue(post);
    mocks.findOne.mockResolvedValue({
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
      status: 'PUBLISHED',
      channelPostId: 'urn:li:share:123',
    } as any;
    const mockedApiFetch = apiFetch as jest.Mock;
    mockedApiFetch.mockResolvedValue({ data: {}, response: {} });

    mocks.findById.mockResolvedValue(post);
    mocks.findOne.mockResolvedValue({
      accessToken: 'encrypted-token',
    });

    await service.deletePost({ _id: userId } as any, postId.toString());

    expect(mocks.getJob).not.toHaveBeenCalled();
    expect(mockedApiFetch).toHaveBeenCalledTimes(1);
    expect(mocks.deleteOne).toHaveBeenCalledTimes(1);
  });
});
