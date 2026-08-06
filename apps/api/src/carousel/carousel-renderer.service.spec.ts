import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CarouselRenderInput } from '../workflow/engine/workflow.types';
import { CarouselAssemblyError } from './carousel-renderer.error';
import { RenderAttemptError } from './carousel-renderer.error';
import {
  browserlessUnitsForDuration,
  CarouselRendererService,
  documentPdfKey,
} from './carousel-renderer.service';
import { CarouselTemplatesService } from './carousel-templates.service';
import { Slide, slidesSchema } from './schemas';

const ASSETS_ROOT = join(process.cwd(), 'assets/carousel');

/** The real fixture deck for a theme: 15 slides at max field lengths. */
const loadFixture = (theme: string): Slide[] => {
  const raw = readFileSync(
    join(ASSETS_ROOT, 'templates', theme, 'fixture.json'),
    'utf-8',
  );
  const parsed = JSON.parse(raw) as { theme: string; slides: unknown };
  return slidesSchema.parse(parsed.slides);
};

const makeInput = (
  slides: Slide[],
  templateId = 'minimal',
): CarouselRenderInput =>
  ({
    artifactId: 'artifact-1',
    version: 2,
    templateId,
    slides,
  }) as unknown as CarouselRenderInput;

const countSlideSections = (html: string): number =>
  (html.match(/<section class="slide /g) ?? []).length;

/**
 * A real `CarouselTemplatesService` so `assembleHtml` runs the actual compiled
 * templates — the pure half needs no Browserless. The network halves
 * (`htmlToPdf`, `uploadFile`) are spied so no request ever leaves the process.
 */
const makeService = () => {
  const templates = new CarouselTemplatesService();
  templates.onModuleInit();
  const service = new CarouselRendererService(templates);

  const pdf = Buffer.from('%PDF-1.4 fake');
  const htmlToPdf = jest
    .spyOn(service as any, 'htmlToPdf')
    .mockResolvedValue(pdf);
  const uploadFile = jest
    .spyOn(service as any, 'uploadFile')
    .mockResolvedValue('https://bucket.r2.cloudflarestorage.com/key');

  return { service, spies: { htmlToPdf, uploadFile }, pdf };
};

describe('CarouselRendererService', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.useRealTimers());

  describe('assembleHtml', () => {
    it('should emit exactly one slide section per slide when given a real fixture deck', () => {
      const { service } = makeService();
      const slides = loadFixture('minimal');

      const html = service.assembleHtml('minimal' as never, slides);

      expect(countSlideSections(html)).toBe(slides.length);
    });

    it('should produce a self-contained document that fetches no external resources', () => {
      const { service } = makeService();
      const slides = loadFixture('bold');

      const html = service.assembleHtml('bold' as never, slides);

      // CSS is inlined; nothing loads over the network (fixture *text* may still
      // contain a url — that is escaped content, not a resource request).
      expect(html).toContain('<!doctype html>');
      expect(html).toContain('<style>');
      expect(html).not.toMatch(/<link\b/i);
      expect(html).not.toMatch(/<script\b/i);
      expect(html).not.toMatch(/\bsrc\s*=/i);
      expect(html).not.toMatch(/url\(\s*['"]?https?:/i);
    });

    it('should wrap an unknown theme as a terminal CarouselAssemblyError', () => {
      const templates = {
        assembleHtml: jest.fn(() => {
          throw new Error('Unknown carousel theme: neon');
        }),
      };
      const service = new CarouselRendererService(templates as any);

      expect(() => service.assembleHtml('neon' as never, [])).toThrow(
        CarouselAssemblyError,
      );
      expect(() => service.assembleHtml('neon' as never, [])).toThrow(
        'Unknown carousel theme: neon',
      );
    });
  });

  describe('render', () => {
    it('should return the object key and page count without exposing an R2 url', async () => {
      const { service } = makeService();
      const slides = loadFixture('editorial');

      const result = await service.render(makeInput(slides, 'editorial'));

      expect(result).toEqual({
        pdfKey: 'artifacts/artifact-1/2/document.pdf',
        pageCount: slides.length,
        browserless: { durationMs: expect.any(Number), units: 1 },
      });
      // R1: the returned render carries the key, never the private-bucket url.
      expect(result.pdfKey).not.toMatch(/^https?:\/\//);
    });

    it('should render the assembled deck once and upload it under the version key', async () => {
      const { service, spies, pdf } = makeService();
      const slides = loadFixture('gradient');

      await service.render(makeInput(slides, 'gradient'));

      expect(spies.htmlToPdf).toHaveBeenCalledTimes(1);
      const renderedHtml = spies.htmlToPdf.mock.calls[0][0] as string;
      expect(countSlideSections(renderedHtml)).toBe(slides.length);

      expect(spies.uploadFile).toHaveBeenCalledTimes(1);
      expect(spies.uploadFile).toHaveBeenCalledWith(
        documentPdfKey('artifact-1', 2),
        pdf,
        'application/pdf',
      );
    });

    it('should not upload anything when assembly fails', async () => {
      const templates = {
        assembleHtml: jest.fn(() => {
          throw new Error('No carousel template for minimal/cover');
        }),
      };
      const service = new CarouselRendererService(templates as any);
      const uploadFile = jest.spyOn(service as any, 'uploadFile');

      await expect(service.render(makeInput([]))).rejects.toBeInstanceOf(
        CarouselAssemblyError,
      );
      expect(uploadFile).not.toHaveBeenCalled();
    });

    it('should propagate a Browserless failure so the step can retry it', async () => {
      const { service, spies } = makeService();
      spies.htmlToPdf.mockRejectedValue(
        new Error('Browserless PDF generation failed: 504'),
      );

      const error = await service
        .render(makeInput(loadFixture('minimal')))
        .catch((e: unknown) => e);

      // Not a CarouselAssemblyError — the step must treat it as retryable.
      expect(error).toBeInstanceOf(RenderAttemptError);
      expect(error).not.toBeInstanceOf(CarouselAssemblyError);
      expect((error as Error).message).toContain(
        'Browserless PDF generation failed',
      );
      expect(error).toMatchObject({
        browserless: { durationMs: expect.any(Number), units: 1 },
        failureStage: 'browserless',
      });
    });

    it('should record Browserless duration and rounded 30-second units', async () => {
      jest.useFakeTimers().setSystemTime(
        new Date('2026-07-13T00:00:00.000Z'),
      );
      const { service, spies, pdf } = makeService();
      spies.htmlToPdf.mockImplementation(async () => {
        jest.setSystemTime(new Date('2026-07-13T00:01:00.001Z'));
        return pdf;
      });

      const result = await service.render(makeInput(loadFixture('minimal')));

      expect(result).toMatchObject({
        browserless: { durationMs: 60_001, units: 3 },
      });
    });

    it('should retain measured Browserless usage when upload fails afterward', async () => {
      jest.useFakeTimers().setSystemTime(
        new Date('2026-07-13T00:00:00.000Z'),
      );
      const { service, spies, pdf } = makeService();
      spies.htmlToPdf.mockImplementation(async () => {
        jest.setSystemTime(new Date('2026-07-13T00:00:30.001Z'));
        return pdf;
      });
      spies.uploadFile.mockRejectedValue(new Error('R2 unavailable'));

      const error = await service
        .render(makeInput(loadFixture('minimal')))
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(RenderAttemptError);
      expect(error).toMatchObject({
        browserless: { durationMs: 30_001, units: 2 },
        failureStage: 'upload',
      });
    });
  });

  describe('browserlessUnitsForDuration', () => {
    it.each([
      [0, 1],
      [1, 1],
      [30_000, 1],
      [30_001, 2],
      [60_000, 2],
      [60_001, 3],
    ])('should resolve %i ms to %i units', (durationMs, units) => {
      expect(browserlessUnitsForDuration(durationMs)).toBe(units);
    });
  });

  describe('documentPdfKey', () => {
    it('should key the pdf by artifact and version so a retry overwrites', () => {
      expect(documentPdfKey('abc', 3)).toBe('artifacts/abc/3/document.pdf');
    });
  });
});
