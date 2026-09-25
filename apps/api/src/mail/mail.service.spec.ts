import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

describe('MailService', () => {
  const mockConfigService = (
    overrides: Record<string, string | undefined> = {},
  ): ConfigService => {
    const values: Record<string, string | undefined> = {
      RESEND_API_KEY: 're_test_123',
      MAIL_FROM: 'noreply@example.com',
      ...overrides,
    };

    return {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;
  };

  const makeService = (overrides: Record<string, string | undefined> = {}) => {
    const service = new MailService(mockConfigService(overrides));
    service.onModuleInit();
    return service;
  };

  const mockResend = (service: MailService) => {
    const send = jest.fn().mockResolvedValue({
      data: { id: 'email_123' },
      error: null,
      headers: null,
    });
    (service as any).resend = { emails: { send } };
    return send;
  };

  it('compiles welcome template and sends through Resend', async () => {
    const service = makeService();
    const send = mockResend(service);

    const result = await service.sendTemplate({
      to: 'user@example.com',
      template: 'welcome',
      data: {
        name: 'Jane Doe',
        appName: 'Marquill',
        dashboardUrl: 'https://example.com/dashboard',
      },
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: expect.stringContaining('noreply@example.com'),
        to: 'user@example.com',
        subject: 'Welcome to Marquill',
      }),
    );
    expect(send.mock.calls[0][0].html).toContain('Jane Doe');
    expect(send.mock.calls[0][0].html).toContain(
      'https://res.cloudinary.com/dnpvndlmy/image/upload/q_auto/f_auto/v1775561659/marquill/logo_nwvdon.svg',
    );
    expect(send.mock.calls[0][0].text).toContain('Open dashboard');
    expect(result.error).toBeNull();
  });

  it('fails fast when RESEND_API_KEY is missing', () => {
    const service = new MailService(
      mockConfigService({ RESEND_API_KEY: undefined }),
    );

    expect(() => service.onModuleInit()).toThrow(
      new InternalServerErrorException('RESEND_API_KEY is not configured'),
    );
  });

  it('fails fast when MAIL_FROM is missing and no override is provided', async () => {
    const service = makeService({ MAIL_FROM: undefined });

    await expect(
      service.sendTemplate({
        to: 'user@example.com',
        template: 'welcome',
        data: { name: 'Jane Doe' },
      }),
    ).rejects.toThrow(
      new InternalServerErrorException('MAIL_FROM is not configured'),
    );
  });

  it('smoke test: sendTemplate succeeds with mocked Resend', async () => {
    const service = makeService();
    const send = jest.fn().mockResolvedValue({
      data: { id: 'email_456' },
      error: null,
      headers: null,
    });
    (service as any).resend = { emails: { send } };

    await expect(
      service.sendTemplate({
        to: ['user@example.com'],
        template: 'welcome',
        data: { name: 'John Doe' },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        data: { id: 'email_456' },
        error: null,
      }),
    );
  });
});
