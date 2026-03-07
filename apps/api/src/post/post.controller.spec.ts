import { HttpStatus } from '@nestjs/common';

jest.mock('./post.service', () => ({
  PostService: class PostService {},
}));
jest.mock('../agent/dto', () => ({ InputDto: class InputDto {} }));
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
  () => ({ User: class User {} }),
  { virtual: true },
);

import { PostController } from './post.controller';

describe('PostController.getPosts', () => {
  it('returns posts in data and filter metadata as sibling field', async () => {
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
      'acc-1',
      'DRAFT',
      '2026-01',
    );

    expect(postService.getPosts).toHaveBeenCalledWith(
      { _id: 'user-1' },
      'acc-1',
      'DRAFT',
      '2026-01',
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
