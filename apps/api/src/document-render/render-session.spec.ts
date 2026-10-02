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
      expect.objectContaining({ width: '1080px', height: '1350px' }),
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

  it('should record why the cover failed and still print when the screenshot fails', async () => {
    mocks.page.screenshot.mockRejectedValue(new Error('capture failed'));

    const result = await renderDocumentSession('ws://b', definition, '');

    expect(result.cover).toEqual({ ok: false, reason: 'capture failed' });
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
