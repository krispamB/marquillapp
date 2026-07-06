import { HttpStatus } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';

jest.mock(
  '../auth/clerk',
  () => ({
    ClerkAuthGuard: class ClerkAuthGuard {},
  }),
  { virtual: true },
);
jest.mock(
  '../common/decorators',
  () => ({
    GetUser: () => () => undefined,
  }),
  { virtual: true },
);
jest.mock(
  '../database/schemas',
  () => ({
    User: class User {},
  }),
  { virtual: true },
);

import { ClerkAuthGuard } from '../auth/clerk';
import { FeedbackController } from './feedback.controller';
import { FeedbackIssueType } from './dto';

describe('FeedbackController', () => {
  it('submits feedback and returns IAppResponse with 201', async () => {
    const created = {
      issueNumber: 123,
      issueUrl: 'https://github.com/acme/repo/issues/123',
      type: FeedbackIssueType.BUG,
    };
    const feedbackService = {
      submitIssue: jest.fn().mockResolvedValue(created),
    } as any;
    const controller = new FeedbackController(feedbackService);

    const response = await controller.submitIssue(
      { _id: 'user-1', email: 'user@example.com' } as any,
      {
        type: FeedbackIssueType.BUG,
        title: 'Editor crashes',
        description: 'It crashes when I upload a large image.',
        deviceReport: {
          browser: 'Chrome 124',
          os: 'macOS 14',
          screenResolution: '1728x1117',
          viewportSize: '1440x900',
          language: 'en-US',
        },
      },
    );

    expect(feedbackService.submitIssue).toHaveBeenCalledWith(
      { _id: 'user-1', email: 'user@example.com' },
      {
        type: FeedbackIssueType.BUG,
        title: 'Editor crashes',
        description: 'It crashes when I upload a large image.',
        deviceReport: {
          browser: 'Chrome 124',
          os: 'macOS 14',
          screenResolution: '1728x1117',
          viewportSize: '1440x900',
          language: 'en-US',
        },
      },
    );
    expect(response).toEqual({
      statusCode: HttpStatus.CREATED,
      message: 'Feedback submitted successfully',
      data: created,
    });
  });

  it('is guarded by ClerkAuthGuard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, FeedbackController);
    expect(guards).toEqual(expect.arrayContaining([ClerkAuthGuard]));
  });
});
