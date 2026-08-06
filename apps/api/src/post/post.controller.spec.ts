import { HttpStatus } from '@nestjs/common';

jest.mock('./post.service', () => ({
  PostService: class PostService {},
}));
jest.mock('../common/guards', () => ({
  JwtAuthGuard: class JwtAuthGuard {},
  SubscriptionAccessGuard: class SubscriptionAccessGuard {},
}));
jest.mock(
  'src/common/decorators',
  () => ({
    GetUser: () => () => undefined,
  }),
  { virtual: true },
);
jest.mock(
  'src/common/interfaces',
  () => ({ IAppResponse: class IAppResponse {} }),
  { virtual: true },
);
jest.mock(
  'src/database/schemas',
  () => ({
    User: class User {},
    PostStatus: {
      DRAFT: 'DRAFT',
      SCHEDULED: 'SCHEDULED',
      PUBLISHED: 'PUBLISHED',
      FAILED: 'FAILED',
    },
  }),
  { virtual: true },
);

import { PostController } from './post.controller';

describe('PostController', () => {
  describe('getPosts', () => {
    it('should return posts and filter metadata when list results exist', async () => {
      const postService = {
        getPosts: jest.fn().mockResolvedValue({
          data: [{ _id: 'post-1' }],
          filters: {
            availableMonths: ['2026-01'],
            connectedAccountIds: ['acc-1'],
          },
        }),
      } as any;

      const controller = new PostController(postService);

      const response = await controller.getPosts(
        { _id: 'user-1' } as any,
        {
          connectedAccount: 'acc-1',
          status: 'SCHEDULED',
          month: '2026-01',
          page: 2,
        } as any,
      );

      expect(postService.getPosts).toHaveBeenCalledWith(
        { _id: 'user-1' },
        'acc-1',
        'SCHEDULED',
        '2026-01',
        2,
      );

      expect(response).toEqual({
        statusCode: HttpStatus.OK,
        message: 'Posts retrieved successfully',
        data: [{ _id: 'post-1' }],
        filters: {
          availableMonths: ['2026-01'],
          connectedAccountIds: ['acc-1'],
        },
      });
    });
  });

  describe('publishPost', () => {
    it('should publish immediately when the post is owned by the user', async () => {
      const post = { _id: 'post-1', status: 'PUBLISHED' };
      const postService = {
        publishPostNow: jest.fn().mockResolvedValue(post),
      } as any;
      const controller = new PostController(postService);
      const user = { _id: 'user-1' } as any;

      const response = await controller.publishPost(user, 'post-1');

      expect(postService.publishPostNow).toHaveBeenCalledWith(user, 'post-1');
      expect(response.data).toBe(post);
    });
  });

  describe('comparePosts', () => {
    it('should return month comparison metrics for the current user', async () => {
      const comparison = {
        current: { month: '2026-07', count: 7 },
        previous: { month: '2026-06', count: 3 },
        difference: 4,
        percentageChange: 133.33,
      };
      const postService = {
        comparePostsByMonth: jest.fn().mockResolvedValue(comparison),
      } as any;
      const controller = new PostController(postService);
      const user = { _id: 'user-1' } as any;

      const response = await controller.comparePosts(user, {
        currentMonth: '2026-07',
        previousMonth: '2026-06',
      });

      expect(postService.comparePostsByMonth).toHaveBeenCalledWith(
        user,
        '2026-07',
        '2026-06',
      );
      expect(response).toEqual({
        statusCode: HttpStatus.OK,
        message: 'Post comparison retrieved successfully',
        data: comparison,
      });
    });
  });

  describe('schedulePost', () => {
    it('should pass scheduledAt when scheduling a post', async () => {
      const post = { _id: 'post-1', status: 'SCHEDULED' };
      const dto = { scheduledAt: '2026-08-01T10:00:00.000Z' };
      const postService = {
        schedulePost: jest.fn().mockResolvedValue(post),
      } as any;
      const controller = new PostController(postService);
      const user = { _id: 'user-1' } as any;

      const response = await controller.schedulePost(user, 'post-1', dto);

      expect(postService.schedulePost).toHaveBeenCalledWith(
        user,
        'post-1',
        dto,
      );
      expect(response.data).toBe(post);
    });
  });

  describe('media composition', () => {
    it('should initiate upload slots for an owned draft', async () => {
      const data = { uploads: [{ mediaId: 'media-1' }] };
      const postService = {
        initiateMediaUpload: jest.fn().mockResolvedValue(data),
      } as any;
      const controller = new PostController(postService);
      const user = { _id: 'user-1' } as any;
      const dto = {
        files: [
          { fileName: 'launch.jpg', mimeType: 'image/jpeg', sizeBytes: 10 },
        ],
      };

      const response = await controller.initiateMediaUpload(
        user,
        'post-1',
        dto,
      );

      expect(postService.initiateMediaUpload).toHaveBeenCalledWith(
        user,
        'post-1',
        dto,
      );
      expect(response.data).toBe(data);
    });

    it('should resolve a media preview through the post', async () => {
      const data = { downloadUrl: 'https://media.test/file' };
      const postService = {
        getMediaPreview: jest.fn().mockResolvedValue(data),
      } as any;
      const controller = new PostController(postService);
      const user = { _id: 'user-1' } as any;

      const response = await controller.getMediaPreview(
        user,
        'post-1',
        'media-1',
      );

      expect(postService.getMediaPreview).toHaveBeenCalledWith(
        user,
        'post-1',
        'media-1',
      );
      expect(response.data).toBe(data);
    });
  });
});
