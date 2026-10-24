import type { DesignSystemDefinition } from '../design-system/design-system-definition';
import { fontStylesheetUrl } from '../document-source/assemble';
import {
  FONT_INLINE_FETCH_TIMEOUT_MS,
  FONT_INLINE_USER_AGENT,
} from './document-render.constants';
import { FontInlinerService } from './font-inliner.service';

const GSTATIC = 'https://fonts.gstatic.com/s/intertight/v9';

const face = (subset: string, file: string, range: string) => `/* ${subset} */
@font-face {
  font-family: 'Inter Tight';
  font-style: normal;
  font-weight: 400 500;
  font-display: block;
  src: url(${GSTATIC}/${file}.woff2) format('woff2');
  unicode-range: ${range};
}
`;

const STYLESHEET = [
  face('cyrillic', 'cyr', 'U+0301, U+0400-045F, U+0490-0491'),
  face('greek', 'grk', 'U+0370-0377, U+037A-037F, U+03A3-03FF'),
  face('symbols', 'sym', 'U+21??'),
  face('latin-ext', 'lext', 'U+0100-02BA, U+1E00-1E9F'),
  face('latin', 'lat', 'U+0000-00FF, U+2000-206F'),
].join('');

const bytesOf = (file: string) => Buffer.from(`woff2:${file}`);
const dataUrlOf = (file: string) =>
  `url(data:font/woff2;base64,${bytesOf(file).toString('base64')})`;

const response = (body: string | Buffer, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: () => Promise.resolve(body.toString()),
  arrayBuffer: () => {
    const buffer = Buffer.from(body);
    return Promise.resolve(
      buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ),
    );
  },
});

const makeService = () => {
  const definition = {
    id: 'margin',
    typography: {
      fonts: [
        {
          name: 'sans',
          family: 'Inter Tight',
          source: 'google',
          weights: [400, 500],
          styles: ['normal'],
        },
      ],
    },
  } as unknown as DesignSystemDefinition;
  const stylesheetUrl = fontStylesheetUrl(definition)!;
  const fetch = jest.fn((url: string) =>
    Promise.resolve(
      url === stylesheetUrl
        ? response(STYLESHEET)
        : response(bytesOf(url.slice(GSTATIC.length + 1, -'.woff2'.length))),
    ),
  );
  const service = new FontInlinerService();
  const warn = jest
    .spyOn(
      (service as unknown as { logger: { warn: () => void } }).logger,
      'warn',
    )
    .mockImplementation(() => undefined);
  return {
    service,
    mocks: { fetch, warn },
    fixtures: { definition, stylesheetUrl },
  };
};

let service: FontInlinerService;
let mocks: ReturnType<typeof makeService>['mocks'];
let fixtures: ReturnType<typeof makeService>['fixtures'];

const fetchedUrls = () => mocks.fetch.mock.calls.map(([url]) => url);

beforeEach(() => {
  jest.restoreAllMocks();
  ({ service, mocks, fixtures } = makeService());
  jest
    .spyOn(global, 'fetch')
    .mockImplementation(mocks.fetch as unknown as typeof fetch);
});

describe('FontInlinerService', () => {
  describe('inlineCss', () => {
    it('should fetch the stylesheet with a Chrome User-Agent and a timeout when called', async () => {
      await service.inlineCss(fixtures.definition, '<p>Hello</p>');

      expect(mocks.fetch).toHaveBeenCalledWith(
        fixtures.stylesheetUrl,
        expect.objectContaining({
          headers: { 'User-Agent': FONT_INLINE_USER_AGENT },
          signal: expect.any(AbortSignal) as AbortSignal,
        }),
      );
      expect(FONT_INLINE_USER_AGENT).toMatch(/Chrome\/\d+/);
      expect(FONT_INLINE_FETCH_TIMEOUT_MS).toBeGreaterThan(0);
    });

    it('should keep only latin and latin-ext when the text is ASCII', async () => {
      const css = await service.inlineCss(fixtures.definition, '<p>Hello</p>');

      expect(css).toContain('/* latin */');
      expect(css).toContain('/* latin-ext */');
      expect(css).not.toContain('/* cyrillic */');
      expect(css).not.toContain('/* greek */');
      expect(css).not.toContain('/* symbols */');
      expect(fetchedUrls().sort()).toEqual(
        [
          fixtures.stylesheetUrl,
          `${GSTATIC}/lat.woff2`,
          `${GSTATIC}/lext.woff2`,
        ].sort(),
      );
    });

    it('should keep a subset whose unicode-range meets the text when it holds other scripts', async () => {
      const css = await service.inlineCss(
        fixtures.definition,
        '<p>Привет</p><p>&#x2192; next</p>',
      );

      expect(css).toContain('/* cyrillic */');
      expect(css).toContain('/* symbols */');
      expect(css).not.toContain('/* greek */');
    });

    it('should read code points from CSS escapes in the candidate stylesheet', async () => {
      const css = await service.inlineCss(
        fixtures.definition,
        '<style>.n::before { content: "\\3a9"; }</style><p>x</p>',
      );

      expect(css).toContain('/* greek */');
    });

    it('should inline each kept file as a woff2 data URL when the fetches succeed', async () => {
      const css = (await service.inlineCss(fixtures.definition, '<p>Hi</p>'))!;

      expect(css).toContain(`src: ${dataUrlOf('lat')} format('woff2');`);
      expect(css).toContain(`src: ${dataUrlOf('lext')} format('woff2');`);
      expect(css).not.toContain('fonts.gstatic.com');
      expect(css).toContain("font-family: 'Inter Tight';");
      expect(css).toContain('unicode-range: U+0000-00FF, U+2000-206F;');
    });

    it('should fetch the stylesheet and each file once per process when called again', async () => {
      await service.inlineCss(fixtures.definition, '<p>Hi</p>');
      const second = await service.inlineCss(fixtures.definition, '<p>Ψ</p>');

      expect(second).toContain('/* greek */');
      expect(
        fetchedUrls().filter((u) => u === fixtures.stylesheetUrl),
      ).toHaveLength(1);
      expect(
        fetchedUrls().filter((u) => u.endsWith('/lat.woff2')),
      ).toHaveLength(1);
      expect(fetchedUrls()).toHaveLength(4);
    });

    it('should return null and warn when the stylesheet fetch fails', async () => {
      mocks.fetch.mockRejectedValueOnce(new Error('ECONNRESET'));

      await expect(
        service.inlineCss(fixtures.definition, '<p>Hi</p>'),
      ).resolves.toBeNull();
      expect(mocks.warn).toHaveBeenCalledWith(
        expect.stringContaining('ECONNRESET'),
      );
    });

    it('should return null when a font file answers with an error status', async () => {
      mocks.fetch.mockImplementation((url: string) =>
        Promise.resolve(
          url === fixtures.stylesheetUrl
            ? response(STYLESHEET)
            : response('', 503),
        ),
      );

      await expect(
        service.inlineCss(fixtures.definition, '<p>Hi</p>'),
      ).resolves.toBeNull();
    });

    it('should return null when the stylesheet has no woff2 faces', async () => {
      mocks.fetch.mockResolvedValueOnce(
        response(
          "@font-face { font-family: 'X'; src: url(https://fonts.gstatic.com/a.ttf) format('truetype'); }",
        ) as never,
      );

      await expect(
        service.inlineCss(fixtures.definition, '<p>Hi</p>'),
      ).resolves.toBeNull();
    });

    it('should evict a rejected fetch so the next call retries it', async () => {
      mocks.fetch.mockRejectedValueOnce(new Error('timeout'));
      await service.inlineCss(fixtures.definition, '<p>Hi</p>');

      const css = await service.inlineCss(fixtures.definition, '<p>Hi</p>');

      expect(css).toContain(dataUrlOf('lat'));
      expect(
        fetchedUrls().filter((u) => u === fixtures.stylesheetUrl),
      ).toHaveLength(2);
    });

    it('should return null without fetching when the definition has no Google fonts', async () => {
      const definition = {
        ...fixtures.definition,
        typography: { fonts: [] },
      } as unknown as DesignSystemDefinition;

      await expect(
        service.inlineCss(definition, '<p>Hi</p>'),
      ).resolves.toBeNull();
      expect(mocks.fetch).not.toHaveBeenCalled();
    });
  });
});
