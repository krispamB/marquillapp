import { Logger } from '@nestjs/common';
import { processEmailJob } from './email.worker.handler';
import {
  SCHEDULED_POST_PUBLISHED_EMAIL_JOB_NAME,
  WELCOME_EMAIL_JOB_NAME,
} from '../workflow.constants';

describe('processEmailJob', () => {
  it('sends welcome email when payload is valid', async () => {
    const logger = {
      log: jest.fn(),
      warn: jest.fn(),
    } as unknown as Logger;
    const mailService = {
      sendTemplate: jest.fn().mockResolvedValue(undefined),
    };

    await processEmailJob(
      {
        id: 'job-1',
        name: WELCOME_EMAIL_JOB_NAME,
        data: {
          email: 'user@example.com',
          name: 'Jane Doe',
        },
      } as any,
      logger,
      mailService as any,
    );

    expect(mailService.sendTemplate).toHaveBeenCalledWith({
      to: 'user@example.com',
      template: 'welcome',
      data: {
        name: 'Jane Doe',
        appName: 'LinkGen',
      },
    });
    expect((logger.warn as jest.Mock)).not.toHaveBeenCalled();
  });

  it('sends scheduled-post-published email when payload is valid', async () => {
    const logger = {
      log: jest.fn(),
      warn: jest.fn(),
    } as unknown as Logger;
    const mailService = {
      sendTemplate: jest.fn().mockResolvedValue(undefined),
    };

    await processEmailJob(
      {
        id: 'job-2',
        name: SCHEDULED_POST_PUBLISHED_EMAIL_JOB_NAME,
        data: {
          email: 'user@example.com',
          name: 'Jane Doe',
          postId: 'post123',
        },
      } as any,
      logger,
      mailService as any,
    );

    expect(mailService.sendTemplate).toHaveBeenCalledWith({
      to: 'user@example.com',
      template: 'scheduledPostPublished',
      data: {
        name: 'Jane Doe',
        postId: 'post123',
      },
    });
    expect((logger.warn as jest.Mock)).not.toHaveBeenCalled();
  });

  it('warns and skips scheduled-post-published email when payload is invalid', async () => {
    const logger = {
      log: jest.fn(),
      warn: jest.fn(),
    } as unknown as Logger;
    const mailService = {
      sendTemplate: jest.fn(),
    };

    await processEmailJob(
      {
        id: 'job-3',
        name: SCHEDULED_POST_PUBLISHED_EMAIL_JOB_NAME,
        data: {
          email: 'user@example.com',
        },
      } as any,
      logger,
      mailService as any,
    );

    expect(logger.warn).toHaveBeenCalledWith(
      'Skipping scheduled post published email job job-3; missing email, name or postId',
    );
    expect(mailService.sendTemplate).not.toHaveBeenCalled();
  });
});
