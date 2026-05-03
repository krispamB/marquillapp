import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FeedbackService } from './feedback.service';
import { FeedbackIssueType } from './dto';

jest.mock(
  '../common/HelperFn',
  () => ({
    apiFetch: jest.fn(),
    ApiError: class ApiError extends Error {
      constructor(
        public statusCode: number,
        public statusText: string,
        public data: any,
      ) {
        super(`HTTP error! status: ${statusCode} ${statusText}`);
        this.name = 'ApiError';
      }
    },
  }),
  { virtual: true },
);

import { ApiError, apiFetch } from '../common/HelperFn';

describe('FeedbackService', () => {
  const createConfigService = (
    overrides: Record<string, string | undefined> = {},
  ) =>
    ({
      get: jest.fn((key: string) => {
        const values: Record<string, string | undefined> = {
          GITHUB_ISSUE_TOKEN: 'ghp_test_token',
          GITHUB_ISSUE_OWNER: 'acme',
          GITHUB_ISSUE_REPO: 'linkgenserver',
          ...overrides,
        };
        return values[key];
      }),
    }) as unknown as ConfigService;

  beforeEach(() => {
    jest.restoreAllMocks();
    (apiFetch as jest.Mock).mockReset();
  });

  it('creates a bug issue with bug label and reporter metadata', async () => {
    const service = new FeedbackService(createConfigService());
    (apiFetch as jest.Mock).mockResolvedValue({
      data: {
        number: 45,
        html_url: 'https://github.com/acme/linkgenserver/issues/45',
      },
      response: { status: 201 },
    });

    const result = await service.submitIssue(
      { _id: 'user-1', email: 'user@example.com' } as any,
      {
        type: FeedbackIssueType.BUG,
        title: 'Cannot schedule post',
        description: 'Clicking schedule throws an error.',
        deviceReport: {
          browser: 'Chrome 124',
          os: 'macOS 14',
          screenResolution: '1728x1117',
          viewportSize: '1440x900',
          language: 'en-US',
        },
      },
    );

    expect(result).toEqual({
      issueNumber: 45,
      issueUrl: 'https://github.com/acme/linkgenserver/issues/45',
      type: FeedbackIssueType.BUG,
    });

    expect(apiFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/acme/linkgenserver/issues',
      expect.objectContaining({
        method: 'POST',
      }),
    );

    const body = JSON.parse((apiFetch as jest.Mock).mock.calls[0][1].body);
    expect(body.title).toBe('Cannot schedule post');
    expect(body.labels).toEqual(['bug']);
    expect(body.body).toContain('## Description');
    expect(body.body).toContain('Clicking schedule throws an error.');
    expect(body.body).toContain('- userId: user-1');
    expect(body.body).toContain('- email: user@example.com');
    expect(body.body).toContain('- submittedAt:');
    expect(body.body).toContain('### Environment Metadata');
    expect(body.body).toContain('| Detail | Value |');
    expect(body.body).toContain('| :--- | :--- |');
    expect(body.body).toContain('| **Browser** | Chrome 124 |');
    expect(body.body).toContain('| **OS** | macOS 14 |');
    expect(body.body).toContain('| **Screen Size** | 1728x1117 |');
    expect(body.body).toContain('| **Viewport** | 1440x900 |');
    expect(body.body).toContain('| **Locale** | en-US |');
  });

  it('creates a feature issue with feature-request label', async () => {
    const service = new FeedbackService(createConfigService());
    (apiFetch as jest.Mock).mockResolvedValue({
      data: {
        number: 46,
        html_url: 'https://github.com/acme/linkgenserver/issues/46',
      },
      response: { status: 201 },
    });

    await service.submitIssue(
      { _id: 'user-2', email: 'jane@example.com' } as any,
      {
        type: FeedbackIssueType.FEATURE_REQUEST,
        title: 'Add post templates',
        description: 'Please add reusable post templates.',
        deviceReport: {
          browser: 'Firefox 125',
          os: 'Windows 11',
          screenResolution: '1920x1080',
          viewportSize: '1536x730',
          language: 'en-GB',
        },
      },
    );

    const body = JSON.parse((apiFetch as jest.Mock).mock.calls[0][1].body);
    expect(body.labels).toEqual(['feature-request']);
  });

  it('throws when GitHub config is missing', async () => {
    const service = new FeedbackService(
      createConfigService({ GITHUB_ISSUE_TOKEN: undefined }),
    );

    await expect(
      service.submitIssue(
        { _id: 'user-1', email: 'user@example.com' } as any,
        {
          type: FeedbackIssueType.BUG,
          title: 'Broken',
          description: 'Broken description',
          deviceReport: {
            browser: 'Chrome 124',
            os: 'macOS 14',
            screenResolution: '1728x1117',
            viewportSize: '1440x900',
            language: 'en-US',
          },
        },
      ),
    ).rejects.toThrow(
      new InternalServerErrorException(
        'GitHub issue integration is not configured',
      ),
    );
  });

  it('maps GitHub 422 errors to BadRequestException', async () => {
    const service = new FeedbackService(createConfigService());
    (apiFetch as jest.Mock).mockRejectedValue(
      new ApiError(422, 'Unprocessable Entity', { message: 'Validation Failed' }),
    );

    await expect(
      service.submitIssue(
        { _id: 'user-1', email: 'user@example.com' } as any,
        {
          type: FeedbackIssueType.BUG,
          title: 'Broken',
          description: 'Broken description',
          deviceReport: {
            browser: 'Chrome 124',
            os: 'macOS 14',
            screenResolution: '1728x1117',
            viewportSize: '1440x900',
            language: 'en-US',
          },
        },
      ),
    ).rejects.toThrow(new BadRequestException('Validation Failed'));
  });

  it('maps non-validation GitHub errors to InternalServerErrorException', async () => {
    const service = new FeedbackService(createConfigService());
    (apiFetch as jest.Mock).mockRejectedValue(
      new ApiError(500, 'Internal Server Error', { message: 'Server Error' }),
    );

    await expect(
      service.submitIssue(
        { _id: 'user-1', email: 'user@example.com' } as any,
        {
          type: FeedbackIssueType.BUG,
          title: 'Broken',
          description: 'Broken description',
          deviceReport: {
            browser: 'Chrome 124',
            os: 'macOS 14',
            screenResolution: '1728x1117',
            viewportSize: '1440x900',
            language: 'en-US',
          },
        },
      ),
    ).rejects.toThrow(new InternalServerErrorException('Server Error'));
  });
});
