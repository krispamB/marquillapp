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
      SCHEDULED: 'SCHEDULED',
      PUBLISHED: 'PUBLISHED',
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
jest.mock('src/s3', () => ({ getFile: jest.fn() }), { virtual: true });

import { PostService } from './post.service';

describe('PostService', () => {
  describe('comparePostsByMonth', () => {
    const makeService = () => {
      const service = Object.create(PostService.prototype) as PostService;
      const countDocuments = jest.fn();
      (service as any).postModel = { countDocuments };
      return {
        service,
        mocks: { countDocuments },
        fixtures: { userId: new Types.ObjectId() },
      };
    };

    let service: PostService;
    let mocks: ReturnType<typeof makeService>['mocks'];
    let fixtures: ReturnType<typeof makeService>['fixtures'];

    beforeEach(() => {
      ({ service, mocks, fixtures } = makeService());
    });

    it('should compare all posts in two UTC calendar months', async () => {
      mocks.countDocuments.mockResolvedValueOnce(7).mockResolvedValueOnce(3);

      const result = await service.comparePostsByMonth(
        { _id: fixtures.userId } as any,
        '2026-07',
        '2026-06',
      );

      expect(mocks.countDocuments).toHaveBeenNthCalledWith(1, {
        user: fixtures.userId,
        createdAt: {
          $gte: new Date('2026-07-01T00:00:00.000Z'),
          $lt: new Date('2026-08-01T00:00:00.000Z'),
        },
      });
      expect(mocks.countDocuments).toHaveBeenNthCalledWith(2, {
        user: fixtures.userId,
        createdAt: {
          $gte: new Date('2026-06-01T00:00:00.000Z'),
          $lt: new Date('2026-07-01T00:00:00.000Z'),
        },
      });
      expect(result).toEqual({
        current: { month: '2026-07', count: 7 },
        previous: { month: '2026-06', count: 3 },
        difference: 4,
        percentageChange: 133.33,
      });
    });

    it('should return a negative difference and percentage for a decline', async () => {
      mocks.countDocuments.mockResolvedValueOnce(1).mockResolvedValueOnce(4);

      await expect(
        service.comparePostsByMonth(
          { _id: fixtures.userId } as any,
          '2026-07',
          '2026-06',
        ),
      ).resolves.toMatchObject({ difference: -3, percentageChange: -75 });
    });

    it('should return null percentage when the previous month has no posts', async () => {
      mocks.countDocuments.mockResolvedValueOnce(2).mockResolvedValueOnce(0);

      await expect(
        service.comparePostsByMonth(
          { _id: fixtures.userId } as any,
          '2026-07',
          '2026-06',
        ),
      ).resolves.toMatchObject({ difference: 2, percentageChange: null });
    });

    it('should preserve UTC calendar years below 100', async () => {
      mocks.countDocuments.mockResolvedValue(0);

      await service.comparePostsByMonth(
        { _id: fixtures.userId } as any,
        '0099-07',
        '0099-06',
      );

      expect(mocks.countDocuments).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          createdAt: {
            $gte: new Date('0099-07-01T00:00:00.000Z'),
            $lt: new Date('0099-08-01T00:00:00.000Z'),
          },
        }),
      );
    });
  });
});
