import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateFeedbackIssueDto, FeedbackIssueType } from './create-feedback-issue.dto';

describe('CreateFeedbackIssueDto', () => {
  const validPayload = {
    type: FeedbackIssueType.BUG,
    title: 'App crashes on save',
    description: 'Clicking save crashes the app.',
    deviceReport: {
      browser: 'Chrome 124',
      os: 'macOS 14',
      screenResolution: '1728x1117',
      viewportSize: '1440x900',
      language: 'en-US',
    },
  };

  it('accepts payload with complete deviceReport', async () => {
    const dto = plainToInstance(CreateFeedbackIssueDto, validPayload);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects payload when deviceReport is missing', async () => {
    const dto = plainToInstance(CreateFeedbackIssueDto, {
      ...validPayload,
      deviceReport: undefined,
    });
    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'deviceReport')).toBe(true);
  });

  it('rejects payload when one nested deviceReport field is missing', async () => {
    const dto = plainToInstance(CreateFeedbackIssueDto, {
      ...validPayload,
      deviceReport: {
        ...validPayload.deviceReport,
        browser: '',
      },
    });
    const errors = await validate(dto);
    const deviceReportError = errors.find((e) => e.property === 'deviceReport');

    expect(deviceReportError).toBeDefined();
    expect(deviceReportError?.children?.length).toBeGreaterThan(0);
  });
});
