import { htmlToPdf } from './html-to-pdf.util';

const mockPdfData = new Uint8Array([37, 80, 68, 70]); // %PDF magic bytes

const makeResponse = (overrides: Partial<Response> = {}): Response =>
  ({
    ok: true,
    status: 200,
    statusText: 'OK',
    arrayBuffer: jest.fn().mockResolvedValue(mockPdfData.buffer),
    text: jest.fn().mockResolvedValue(''),
    ...overrides,
  }) as unknown as Response;

const getRequestBody = (mock: jest.Mock) =>
  JSON.parse((mock.mock.calls[0][1] as RequestInit).body as string);

describe('htmlToPdf', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BROWSERLESS_URL = 'https://production-sfo.browserless.io';
    process.env.BROWSERLESS_TOKEN = 'test-token';
    fetchMock = jest.fn().mockResolvedValue(makeResponse());
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    delete process.env.BROWSERLESS_URL;
    delete process.env.BROWSERLESS_TOKEN;
  });

  describe('return value', () => {
    it('should return a Buffer containing the PDF data', async () => {
      const result = await htmlToPdf('<h1>Hello</h1>');
      expect(result).toBeInstanceOf(Buffer);
      expect(result).toEqual(Buffer.from(mockPdfData));
    });
  });

  describe('request target', () => {
    it('should POST to the browserless /pdf endpoint with the token', async () => {
      await htmlToPdf('<p>test</p>');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://production-sfo.browserless.io/pdf?token=test-token',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should not duplicate the slash when BROWSERLESS_URL has a trailing slash', async () => {
      process.env.BROWSERLESS_URL = 'https://production-sfo.browserless.io/';
      await htmlToPdf('<p>test</p>');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://production-sfo.browserless.io/pdf?token=test-token',
        expect.anything(),
      );
    });

    it('should send JSON content-type headers', async () => {
      await htmlToPdf('<p>test</p>');
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(init.headers).toMatchObject({
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      });
    });

    it('should throw when BROWSERLESS_URL is not set', async () => {
      delete process.env.BROWSERLESS_URL;
      await expect(htmlToPdf('<p>test</p>')).rejects.toThrow(
        'BROWSERLESS_URL is not configured',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should throw when BROWSERLESS_TOKEN is not set', async () => {
      delete process.env.BROWSERLESS_TOKEN;
      await expect(htmlToPdf('<p>test</p>')).rejects.toThrow(
        'BROWSERLESS_TOKEN is not configured',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('viewport', () => {
    it('should set viewport to 1080x1350 by default', async () => {
      await htmlToPdf('<p>test</p>');
      expect(getRequestBody(fetchMock).viewport).toEqual({
        width: 1080,
        height: 1350,
      });
    });

    it('should set viewport to match custom width and height', async () => {
      await htmlToPdf('<p>test</p>', { width: '800px', height: '600px' });
      expect(getRequestBody(fetchMock).viewport).toEqual({
        width: 800,
        height: 600,
      });
    });
  });

  describe('page content', () => {
    it('should send the provided HTML and networkidle0 wait condition', async () => {
      const html = '<div>My Document</div>';
      await htmlToPdf(html);
      const body = getRequestBody(fetchMock);
      expect(body.html).toBe(html);
      expect(body.gotoOptions).toEqual({ waitUntil: 'networkidle0' });
    });
  });

  describe('default options', () => {
    it('should send 1080x1350 pixel dimensions and zero margins', async () => {
      await htmlToPdf('<p>test</p>');
      expect(getRequestBody(fetchMock).options).toEqual({
        width: '1080px',
        height: '1350px',
        margin: { top: '0', bottom: '0', left: '0', right: '0' },
        printBackground: true,
        landscape: false,
      });
    });
  });

  describe('custom options', () => {
    it('should override width and height when provided', async () => {
      await htmlToPdf('<p>test</p>', { width: '1920px', height: '1080px' });
      expect(getRequestBody(fetchMock).options).toMatchObject({
        width: '1920px',
        height: '1080px',
      });
    });

    it('should override landscape when provided', async () => {
      await htmlToPdf('<p>test</p>', { landscape: true });
      expect(getRequestBody(fetchMock).options).toMatchObject({
        landscape: true,
      });
    });

    it('should override printBackground when provided', async () => {
      await htmlToPdf('<p>test</p>', { printBackground: false });
      expect(getRequestBody(fetchMock).options).toMatchObject({
        printBackground: false,
      });
    });

    it('should override margin when provided', async () => {
      const margin = { top: '10px', bottom: '10px', left: '5px', right: '5px' };
      await htmlToPdf('<p>test</p>', { margin });
      expect(getRequestBody(fetchMock).options).toMatchObject({ margin });
    });

    it('should keep defaults for options not explicitly overridden', async () => {
      await htmlToPdf('<p>test</p>', { width: '800px' });
      expect(getRequestBody(fetchMock).options).toMatchObject({
        width: '800px',
        height: '1350px',
        printBackground: true,
        landscape: false,
        margin: { top: '0', bottom: '0', left: '0', right: '0' },
      });
    });
  });

  describe('error propagation', () => {
    it('should throw when the browserless response is not ok', async () => {
      fetchMock.mockResolvedValueOnce(
        makeResponse({
          ok: false,
          status: 422,
          statusText: 'Unprocessable Entity',
          text: jest.fn().mockResolvedValue('bad html'),
        } as Partial<Response>),
      );
      await expect(htmlToPdf('<p>test</p>')).rejects.toThrow(
        'Browserless PDF generation failed: 422 Unprocessable Entity - bad html',
      );
    });

    it('should propagate errors thrown by fetch', async () => {
      fetchMock.mockRejectedValueOnce(new Error('connection refused'));
      await expect(htmlToPdf('<p>test</p>')).rejects.toThrow(
        'connection refused',
      );
    });
  });
});
