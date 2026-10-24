jest.mock(
  'puppeteer-core',
  () => ({ __esModule: true, default: { connect: jest.fn() } }),
  { virtual: true },
);

import puppeteer from 'puppeteer-core';
import type { DesignSystemDefinition } from '../design-system/design-system-definition';
import {
  browserlessEndpoint,
  renderDocumentSession,
  RenderSessionError,
} from './render-session';

const connect = puppeteer.connect as unknown as jest.Mock;

const definition = {
  page: { width: 1080, height: 1350 },
} as DesignSystemDefinition;

const PDF = new TextEncoder().encode(
  '1 0 obj << /Type /Pages /Count 2 >> endobj\n' +
    '2 0 obj << /Type /Page >> endobj\n3 0 obj << /Type /Page >> endobj\n',
);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const probed = {
  pages: [
    { index: 1, role: 'title', rect: { x: 0, y: 0, w: 1080, h: 1350 } },
    { index: 2, role: 'end', rect: { x: 0, y: 1350, w: 1080, h: 1350 } },
  ],
  elements: [
    { idx: 0, page: 1, textRects: [], label: 'div.leaf' },
    { idx: 1, page: 1, textRects: [{ x: 0, y: 0, w: 1, h: 1 }], label: 'h1' },
  ],
  faces: [
    { family: 'Inter Tight', weight: '400', style: 'normal', status: 'loaded' },
  ],
};

interface FakeRequest {
  url: () => string;
  isInterceptResolutionHandled: () => boolean;
  continue: jest.Mock;
  abort: jest.Mock;
}

const request = (url: string): FakeRequest => ({
  url: () => url,
  isInterceptResolutionHandled: () => false,
  continue: jest.fn().mockResolvedValue(undefined),
  abort: jest.fn().mockResolvedValue(undefined),
});

const makeSession = () => {
  let onRequest: ((r: FakeRequest) => void) | undefined;
  const cdp = {
    send: jest.fn((method: string) => {
      if (method === 'DOM.getDocument')
        return Promise.resolve({ root: { nodeId: 1 } });
      if (method === 'DOM.querySelectorAll')
        return Promise.resolve({ nodeIds: [10, 11] });
      if (method === 'CSS.getPlatformFontsForNode')
        return Promise.resolve({
          fonts: [
            { familyName: 'Inter Tight', isCustomFont: true, glyphCount: 5 },
          ],
        });
      return Promise.resolve({});
    }),
    detach: jest.fn().mockResolvedValue(undefined),
  };
  const page = {
    setJavaScriptEnabled: jest.fn().mockResolvedValue(undefined),
    setRequestInterception: jest.fn().mockResolvedValue(undefined),
    on: jest.fn((event: string, handler: (r: FakeRequest) => void) => {
      if (event === 'request') onRequest = handler;
    }),
    emulateMediaType: jest.fn().mockResolvedValue(undefined),
    setViewport: jest.fn().mockResolvedValue(undefined),
    setContent: jest.fn().mockResolvedValue(undefined),
    evaluate: jest.fn().mockResolvedValue(probed),
    createCDPSession: jest.fn().mockResolvedValue(cdp),
    screenshot: jest.fn().mockResolvedValue(PNG),
    pdf: jest.fn().mockResolvedValue(PDF),
  };
  const browser = {
    newPage: jest.fn().mockResolvedValue(page),
    disconnect: jest.fn().mockResolvedValue(undefined),
  };
  connect.mockResolvedValue(browser);
  return {
    mocks: { page, browser, cdp },
    sendRequest: (r: FakeRequest) => onRequest!(r),
  };
};

let mocks: ReturnType<typeof makeSession>['mocks'];
let sendRequest: ReturnType<typeof makeSession>['sendRequest'];

beforeEach(() => {
  jest.clearAllMocks();
  ({ mocks, sendRequest } = makeSession());
});

describe('renderDocumentSession', () => {
  it('should run the §5.1 steps on one connected session when the render succeeds', async () => {
    const result = await renderDocumentSession(
      'ws://browserless',
      definition,
      '<html></html>',
    );

    expect(connect).toHaveBeenCalledWith({
      browserWSEndpoint: 'ws://browserless',
    });
    expect(mocks.page.setJavaScriptEnabled).toHaveBeenCalledWith(false);
    expect(mocks.page.setRequestInterception).toHaveBeenCalledWith(true);
    expect(mocks.page.emulateMediaType).toHaveBeenCalledWith('print');
    expect(mocks.page.setViewport).toHaveBeenCalledWith({
      width: 1080,
      height: 1350,
    });
    expect(mocks.page.setContent).toHaveBeenCalledWith('<html></html>', {
      waitUntil: 'load',
      timeout: 0,
    });
    expect(mocks.cdp.send).toHaveBeenCalledWith('CSS.getPlatformFontsForNode', {
      nodeId: 11,
    });
    expect(mocks.page.screenshot).toHaveBeenCalledWith({
      type: 'png',
      clip: { x: 0, y: 0, width: 1080, height: 1350 },
    });
    expect(mocks.page.pdf).toHaveBeenCalledWith(
      expect.objectContaining({
        width: '1080px',
        height: '1350px',
        waitForFonts: false,
      }),
    );
    expect(mocks.browser.disconnect).toHaveBeenCalledTimes(1);

    expect(result.facts.pages).toEqual(probed.pages);
    expect(result.facts.platformFonts).toEqual({
      1: [{ familyName: 'Inter Tight', isCustomFont: true, glyphCount: 5 }],
    });
    expect(result.facts.pdfPageCount).toBe(2);
    expect(result.pageCount).toBe(2);
    expect(result.pdf).toBe(PDF);
    expect(result.cover).toEqual({ ok: true, png: PNG });
    expect(result.usage.units).toBe(1);
    expect(result.usage.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should attach the request listener before interception is enabled', async () => {
    await renderDocumentSession('ws://b', definition, '');

    const listenerAt = mocks.page.on.mock.invocationCallOrder[0];
    expect(listenerAt).toBeLessThan(
      mocks.page.setRequestInterception.mock.invocationCallOrder[0],
    );
  });

  it('should start every setup call before any of them resolves', async () => {
    const settle: (() => void)[] = [];
    const pending = () =>
      jest.fn(() => new Promise<void>((resolve) => settle.push(resolve)));
    mocks.page.setJavaScriptEnabled = pending();
    mocks.page.setRequestInterception = pending();
    mocks.page.emulateMediaType = pending();
    mocks.page.setViewport = pending();

    const run = renderDocumentSession('ws://b', definition, '');
    await new Promise((resolve) => setImmediate(resolve));

    expect(settle).toHaveLength(4);
    expect(mocks.page.createCDPSession).toHaveBeenCalledTimes(1);
    settle.forEach((resolve) => resolve());
    await run;
  });

  it('should send the font pass setup calls in order without waiting on each', async () => {
    await renderDocumentSession('ws://b', definition, '');

    const methods = mocks.cdp.send.mock.calls.map(([method]) => method);
    expect(methods.slice(0, 4)).toEqual([
      'DOM.enable',
      'CSS.enable',
      'DOM.getDocument',
      'DOM.querySelectorAll',
    ]);
  });

  it('should not wait on the CDP detach or the browser disconnect', async () => {
    mocks.cdp.detach.mockReturnValue(new Promise(() => undefined));
    mocks.browser.disconnect.mockReturnValue(new Promise(() => undefined));

    const result = await renderDocumentSession('ws://b', definition, '');

    expect(mocks.cdp.detach).toHaveBeenCalledTimes(1);
    expect(mocks.browser.disconnect).toHaveBeenCalledTimes(1);
    expect(result.pdf).toBe(PDF);
  });

  it('should swallow a failed detach or disconnect', async () => {
    mocks.cdp.detach.mockRejectedValue(new Error('already closed'));
    mocks.browser.disconnect.mockRejectedValue(new Error('already closed'));

    const result = await renderDocumentSession('ws://b', definition, '');
    await new Promise((resolve) => setImmediate(resolve));

    expect(result.pdf).toBe(PDF);
  });

  it('should hand over a disconnect that settles even when the disconnect fails', async () => {
    mocks.browser.disconnect.mockRejectedValue(new Error('already closed'));
    const onDisconnect = jest.fn<void, [Promise<void>]>();

    await renderDocumentSession('ws://b', definition, '', { onDisconnect });

    expect(onDisconnect).toHaveBeenCalledTimes(1);
    await expect(onDisconnect.mock.calls[0][0]).resolves.toBeUndefined();
  });

  it('should let font requests through and record each refused URL once', async () => {
    const font = request('https://fonts.googleapis.com/css2?family=Inter');
    const file = request('https://fonts.gstatic.com/s/inter/v1/a.woff2');
    const beacon = request('https://example.com/beacon.png');
    const again = request('https://example.com/beacon.png');
    mocks.page.setContent.mockImplementation(() => {
      [font, file, beacon, again].forEach(sendRequest);
      return Promise.resolve();
    });

    const result = await renderDocumentSession('ws://b', definition, '');

    expect(font.continue).toHaveBeenCalled();
    expect(file.continue).toHaveBeenCalled();
    expect(beacon.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(again.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(result.refusedRequests).toEqual(['https://example.com/beacon.png']);
    expect(result.facts.refusedRequests).toEqual(result.refusedRequests);
  });

  it('should continue an inlined font data URL and not record it as refused', async () => {
    const inlined = request('data:font/woff2;base64,d09GMgABAAAAAA');
    mocks.page.setContent.mockImplementation(() => {
      sendRequest(inlined);
      return Promise.resolve();
    });

    const result = await renderDocumentSession('ws://b', definition, '');

    expect(inlined.continue).toHaveBeenCalled();
    expect(inlined.abort).not.toHaveBeenCalled();
    expect(result.refusedRequests).toEqual([]);
  });

  it('should refuse a data URL that is not a font', async () => {
    const image = request('data:image/png;base64,iVBORw0KGgo');
    mocks.page.setContent.mockImplementation(() => {
      sendRequest(image);
      return Promise.resolve();
    });

    const result = await renderDocumentSession('ws://b', definition, '');

    expect(image.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(result.refusedRequests).toEqual([
      'data:image/png;base64,iVBORw0KGgo',
    ]);
  });

  it('should record why the cover failed and still print when the screenshot fails', async () => {
    mocks.page.screenshot.mockRejectedValue(new Error('capture failed'));

    const result = await renderDocumentSession('ws://b', definition, '');

    expect(result.cover).toEqual({ ok: false, reason: 'capture failed' });
    expect(result.pdf).toBe(PDF);
  });

  it('should skip the cover and still print when skipCover returns true', async () => {
    const skipCover = jest.fn().mockReturnValue(true);

    const result = await renderDocumentSession('ws://b', definition, '', {
      skipCover,
    });

    expect(skipCover).toHaveBeenCalledWith(
      expect.objectContaining({ pages: probed.pages }),
    );
    expect(mocks.page.screenshot).not.toHaveBeenCalled();
    expect(result.cover.ok).toBe(false);
    expect(result.pdf).toBe(PDF);
    expect(result.pageCount).toBe(2);
  });

  it('should capture the cover when skipCover returns false', async () => {
    const result = await renderDocumentSession('ws://b', definition, '', {
      skipCover: () => false,
    });

    expect(mocks.page.screenshot).toHaveBeenCalledTimes(1);
    expect(result.cover).toEqual({ ok: true, png: PNG });
    expect(result.pdf).toBe(PDF);
  });

  it('should report a timeout and disconnect when the deadline expires', async () => {
    mocks.page.setContent.mockReturnValue(new Promise(() => undefined));

    const result = await renderDocumentSession('ws://b', definition, '', {
      deadlineMs: 20,
    });

    expect(result.facts.timedOut).toBe(true);
    expect(result.pdf).toBeNull();
    expect(result.pageCount).toBeNull();
    expect(result.cover.ok).toBe(false);
    expect(mocks.page.pdf).not.toHaveBeenCalled();
    expect(mocks.browser.disconnect).toHaveBeenCalledTimes(1);
  });

  it('should disconnect a session that connects after the deadline', async () => {
    let finishConnect: (b: unknown) => void = () => undefined;
    connect.mockReturnValue(
      new Promise((resolve) => {
        finishConnect = resolve;
      }),
    );

    const result = await renderDocumentSession('ws://b', definition, '', {
      deadlineMs: 5,
    });
    finishConnect(mocks.browser);
    await new Promise((resolve) => setImmediate(resolve));

    expect(result.facts.timedOut).toBe(true);
    expect(mocks.browser.newPage).not.toHaveBeenCalled();
    expect(mocks.browser.disconnect).toHaveBeenCalledTimes(1);
  });

  it('should throw a RenderSessionError carrying the usage when the session fails', async () => {
    mocks.page.evaluate.mockRejectedValue(new Error('Protocol error'));

    const error = await renderDocumentSession('ws://b', definition, '').catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(RenderSessionError);
    expect((error as RenderSessionError).message).toContain('Protocol error');
    expect((error as RenderSessionError).usage.units).toBe(1);
    expect(mocks.browser.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('phase trace', () => {
  const never = () => new Promise<never>(() => undefined);
  const hangs: [phase: string, hang: () => void][] = [
    ['connect', () => connect.mockReturnValue(never())],
    ['setup', () => mocks.browser.newPage.mockReturnValue(never())],
    ['load', () => mocks.page.setContent.mockReturnValue(never())],
    ['probe', () => mocks.page.evaluate.mockReturnValue(never())],
    [
      'fontPass',
      () =>
        mocks.cdp.send.mockImplementation((method: string) =>
          method === 'DOM.getDocument' ? never() : Promise.resolve({}),
        ),
    ],
    ['cover', () => mocks.page.screenshot.mockReturnValue(never())],
    ['pdf', () => mocks.page.pdf.mockReturnValue(never())],
  ];

  it.each(hangs)(
    'should name %s as the phase when the session hangs there',
    async (phase, hang) => {
      hang();

      const result = await renderDocumentSession('ws://b', definition, '', {
        deadlineMs: 20,
      });

      expect(result.facts.timedOut).toBe(true);
      expect(result.trace.phase).toBe(phase);
      expect(result.trace.phaseMs[phase as 'pdf']).toBeGreaterThanOrEqual(15);
    },
  );

  it('should time every phase the hung session passed through', async () => {
    mocks.page.evaluate.mockReturnValue(never());

    const { trace } = await renderDocumentSession('ws://b', definition, '', {
      deadlineMs: 20,
    });

    expect(Object.keys(trace.phaseMs)).toEqual([
      'connect',
      'setup',
      'load',
      'probe',
    ]);
  });

  it('should record the timing of each phase when the session passes', async () => {
    const result = await renderDocumentSession('ws://b', definition, '');

    expect(result.facts.timedOut).toBe(false);
    expect(result.trace.phase).toBe('pdf');
    expect(Object.keys(result.trace.phaseMs)).toEqual([
      'connect',
      'setup',
      'load',
      'probe',
      'fontPass',
      'cover',
      'pdf',
    ]);
  });

  it('should keep the trace of a session that connects after the deadline', async () => {
    let finishConnect: (b: unknown) => void = () => undefined;
    connect.mockReturnValue(
      new Promise((resolve) => {
        finishConnect = resolve;
      }),
    );

    const result = await renderDocumentSession('ws://b', definition, '', {
      deadlineMs: 5,
    });
    const before = JSON.stringify(result.trace);
    finishConnect(mocks.browser);
    await new Promise((resolve) => setImmediate(resolve));

    expect(result.trace.phase).toBe('connect');
    expect(JSON.stringify(result.trace)).toBe(before);
  });

  it('should carry the phase a failed session reached on the RenderSessionError', async () => {
    mocks.page.evaluate.mockRejectedValue(new Error('Protocol error'));

    const error = await renderDocumentSession('ws://b', definition, '').catch(
      (e: unknown) => e,
    );

    expect((error as RenderSessionError).trace?.phase).toBe('probe');
    expect(
      Object.keys((error as RenderSessionError).trace?.phaseMs ?? {}),
    ).toEqual(['connect', 'setup', 'load', 'probe']);
  });
});

describe('browserlessEndpoint', () => {
  it('should build a WebSocket URL with the token and a backstop timeout', () => {
    expect(
      browserlessEndpoint(
        'https://production-sfo.browserless.io',
        'tok',
        60000,
      ),
    ).toBe('wss://production-sfo.browserless.io/?token=tok&timeout=70000');
  });
});
