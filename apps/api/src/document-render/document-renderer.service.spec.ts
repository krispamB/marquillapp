// Loading the real puppeteer-core leaves process-wide state behind that breaks
// `render-session.spec.ts` when both run in one worker, so it is never loaded
// here: the session itself is stubbed per test.
jest.mock(
  'puppeteer-core',
  () => ({ __esModule: true, default: { connect: jest.fn() } }),
  { virtual: true },
);

import { DocumentRendererService } from './document-renderer.service';
import type { RenderSessionResult } from './render-session';

describe('DocumentRendererService', () => {
  const makeService = (env: Record<string, string | undefined>) => {
    const config = {
      getOrThrow: jest.fn((key: string) => {
        const value = env[key];
        if (value === undefined) throw new Error(`${key} is not configured`);
        return value;
      }),
    };
    const service = new DocumentRendererService(config as never);
    const result = { pageCount: 3 } as unknown as RenderSessionResult;
    const renderSession = jest
      .spyOn(
        service as unknown as { renderSession: () => Promise<unknown> },
        'renderSession',
      )
      .mockResolvedValue(result);
    return { service, mocks: { config, renderSession }, fixtures: { result } };
  };

  describe('render', () => {
    it('should open one session on the configured Browserless endpoint', async () => {
      const { service, mocks, fixtures } = makeService({
        BROWSERLESS_URL: 'https://production-sfo.browserless.io',
        BROWSERLESS_TOKEN: 'secret-token',
      });
      const definition = { id: 'margin' } as never;

      await expect(service.render(definition, '<html></html>')).resolves.toBe(
        fixtures.result,
      );

      const [endpoint, passedDefinition, source] = mocks.renderSession.mock
        .calls[0] as unknown as [string, unknown, string];
      const url = new URL(endpoint);
      expect(url.protocol).toBe('wss:');
      expect(url.host).toBe('production-sfo.browserless.io');
      expect(url.searchParams.get('token')).toBe('secret-token');
      expect(passedDefinition).toBe(definition);
      expect(source).toBe('<html></html>');
    });

    it('should fail without opening a session when Browserless is not configured', async () => {
      const { service, mocks } = makeService({});

      await expect(
        service.render({} as never, '<html></html>'),
      ).rejects.toThrow('BROWSERLESS_URL is not configured');
      expect(mocks.renderSession).not.toHaveBeenCalled();
    });
  });
});
