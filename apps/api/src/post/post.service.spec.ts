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

import { PostService } from './post.service';

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
