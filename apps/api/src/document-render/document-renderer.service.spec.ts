// Loading the real puppeteer-core leaves process-wide state behind that breaks
// `render-session.spec.ts` when both run in one worker, so it is never loaded
// here: the session itself is stubbed per test.
jest.mock(
  'puppeteer-core',
  () => ({ __esModule: true, default: { connect: jest.fn() } }),
  { virtual: true },
);

import * as judgeModule from './judge';
import { DocumentRendererService } from './document-renderer.service';
import type {
  RenderSessionOptions,
  RenderSessionResult,
} from './render-session';
import { RenderSessionError } from './render-session.error';
import { RenderSlotUnavailableError } from './render-slots';

describe('DocumentRendererService', () => {
  const makeService = (env: Record<string, string | undefined>) => {
    const config = {
      getOrThrow: jest.fn((key: string) => {
        const value = env[key];
        if (value === undefined) throw new Error(`${key} is not configured`);
        return value;
      }),
    };
    const release = jest.fn(() => Promise.resolve());
    const slots = {
      acquire: jest.fn(() => Promise.resolve({ waitedMs: 1_500, release })),
    };
    const service = new DocumentRendererService(
      config as never,
      slots as never,
    );
    const result = { pageCount: 3 } as unknown as RenderSessionResult;
    const renderSession = jest
      .spyOn(
        service as unknown as { renderSession: () => Promise<unknown> },
        'renderSession',
      )
      .mockResolvedValue(result);
    return {
      service,
      mocks: { config, renderSession, slots, release },
      fixtures: { result },
    };
  };

  describe('render', () => {
    it('should open one session on the configured Browserless endpoint', async () => {
      const { service, mocks, fixtures } = makeService({
        BROWSERLESS_URL: 'https://production-sfo.browserless.io',
        BROWSERLESS_TOKEN: 'secret-token',
      });
      const definition = { id: 'margin' } as never;

      await expect(
        service.render(definition, '<html></html>'),
      ).resolves.toMatchObject(fixtures.result);

      const [endpoint, passedDefinition, source] = mocks.renderSession.mock
        .calls[0] as unknown as [string, unknown, string];
      const url = new URL(endpoint);
      expect(url.protocol).toBe('wss:');
      expect(url.host).toBe('production-sfo.browserless.io');
      expect(url.searchParams.get('token')).toBe('secret-token');
      expect(passedDefinition).toBe(definition);
      expect(source).toBe('<html></html>');
    });

    it('should skip the cover exactly when the probe has findings', async () => {
      const { service, mocks } = makeService({
        BROWSERLESS_URL: 'https://production-sfo.browserless.io',
        BROWSERLESS_TOKEN: 'secret-token',
      });
      const definition = { id: 'margin' } as never;
      const facts = { measured: true } as never;
      const judged = jest.spyOn(judgeModule, 'judge');

      await service.render(definition, '<html></html>');

      const { skipCover } = (
        mocks.renderSession.mock.calls[0] as unknown as [
          string,
          unknown,
          string,
          { skipCover: (f: never) => boolean },
        ]
      )[3];
      judged.mockReturnValueOnce([{ code: 'layout.overflow' } as never]);
      expect(skipCover(facts)).toBe(true);
      judged.mockReturnValueOnce([]);
      expect(skipCover(facts)).toBe(false);
      expect(judged).toHaveBeenCalledWith(definition, facts);
    });

    it('should fail without opening a session when Browserless is not configured', async () => {
      const { service, mocks } = makeService({});

      await expect(
        service.render({} as never, '<html></html>'),
      ).rejects.toThrow('BROWSERLESS_URL is not configured');
      expect(mocks.renderSession).not.toHaveBeenCalled();
      expect(mocks.slots.acquire).not.toHaveBeenCalled();
    });
  });

  describe('render with a slot', () => {
    const env = {
      BROWSERLESS_URL: 'https://production-sfo.browserless.io',
      BROWSERLESS_TOKEN: 'secret-token',
    };

    it('should take a slot before the session and release it after when the session passes', async () => {
      const { service, mocks } = makeService(env);
      const order: string[] = [];
      mocks.slots.acquire.mockImplementationOnce(() => {
        order.push('acquire');
        return Promise.resolve({ waitedMs: 1_500, release: mocks.release });
      });
      mocks.renderSession.mockImplementationOnce(() => {
        order.push('session');
        return Promise.resolve({ pageCount: 3 });
      });
      mocks.release.mockImplementationOnce(() => {
        order.push('release');
        return Promise.resolve();
      });

      const result = await service.render({} as never, '<html></html>', {
        maxSlotWaitMs: 40_000,
      });

      expect(order).toEqual(['acquire', 'session', 'release']);
      expect(mocks.slots.acquire).toHaveBeenCalledWith(40_000);
      expect(result.slotWaitMs).toBe(1_500);
    });

    it('should hold the slot until the session disconnects when the result returns first', async () => {
      const { service, mocks } = makeService(env);
      let closeSocket!: () => void;
      mocks.renderSession.mockImplementationOnce(
        (
          _endpoint: string,
          _definition: unknown,
          _source: string,
          options: RenderSessionOptions,
        ) => {
          options.onDisconnect?.(
            new Promise<void>((resolve) => (closeSocket = resolve)),
          );
          return Promise.resolve({ pageCount: 3 });
        },
      );

      await service.render({} as never, '<html></html>');
      expect(mocks.release).not.toHaveBeenCalled();

      closeSocket();
      await new Promise(setImmediate);
      expect(mocks.release).toHaveBeenCalledTimes(1);
    });

    it('should release the slot and carry the wait on the error when the session fails', async () => {
      const { service, mocks } = makeService(env);
      const failure = new RenderSessionError('socket hang up', {
        durationMs: 2_000,
        units: 1,
      });
      mocks.renderSession.mockRejectedValueOnce(failure);

      await expect(
        service.render({} as never, '<html></html>', { maxSlotWaitMs: 1_000 }),
      ).rejects.toBe(failure);
      expect(failure.slotWaitMs).toBe(1_500);
      expect(mocks.release).toHaveBeenCalledTimes(1);
    });

    it('should open no session when no slot comes free', async () => {
      const { service, mocks } = makeService(env);
      mocks.slots.acquire.mockRejectedValueOnce(
        new RenderSlotUnavailableError(2, 40_000),
      );

      await expect(
        service.render({} as never, '<html></html>', { maxSlotWaitMs: 40_000 }),
      ).rejects.toBeInstanceOf(RenderSlotUnavailableError);
      expect(mocks.renderSession).not.toHaveBeenCalled();
    });

    it('should wait as long as the semaphore allows when the caller gives no bound', async () => {
      const { service, mocks } = makeService(env);

      await service.render({} as never, '<html></html>');

      expect(mocks.slots.acquire).toHaveBeenCalledWith(Infinity);
    });
  });
});
