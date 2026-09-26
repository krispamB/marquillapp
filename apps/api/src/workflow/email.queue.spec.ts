import { EmailQueue } from './email.queue';

describe('EmailQueue', () => {
  it('adds scheduled-post-published email job with jobId that has no colon', async () => {
    const service = new EmailQueue({} as any);
    const add = jest.fn().mockResolvedValue(undefined);
    (service as any).queue = { add };

    await service.addScheduledPostPublishedEmailJob(
      'user@example.com',
      'Jane Doe',
      'post123',
    );

    expect(add).toHaveBeenCalledWith(
      'scheduled-post-published-email',
      {
        email: 'user@example.com',
        name: 'Jane Doe',
        postId: 'post123',
      },
      expect.objectContaining({
        jobId: 'scheduled-post-published-post123',
      }),
    );

    const options = add.mock.calls[0][2];
    expect(options.jobId.includes(':')).toBe(false);
  });
});
