import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FeedbackService } from './feedback.service';
import { FeedbackIssueType } from './dto';

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
    (global as any).fetch = jest.fn();
  });

  it('creates a bug issue with bug label and reporter metadata', async () => {
    const service = new FeedbackService(createConfigService());
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: jest.fn().mockResolvedValue({
        number: 45,
        html_url: 'https://github.com/acme/linkgenserver/issues/45',
      }),
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

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/acme/linkgenserver/issues',
      expect.objectContaining({
        method: 'POST',
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
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
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: jest.fn().mockResolvedValue({
        number: 46,
        html_url: 'https://github.com/acme/linkgenserver/issues/46',
      }),
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

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
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
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      json: jest.fn().mockResolvedValue({
        message: 'Validation Failed',
      }),
    });

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
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: jest.fn().mockResolvedValue({
        message: 'Server Error',
      }),
    });

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
