import { Injectable } from '@nestjs/common';
import type { CarouselTheme } from '../database/schemas';
import type { VersionRender } from '../artifact/artifact-writer.interface';
import type {
  CarouselRenderer,
  CarouselRenderInput,
} from '../workflow/engine/workflow.types';
import { uploadFile } from '../s3';
import { CarouselTemplatesService } from './carousel-templates.service';
import {
  CarouselAssemblyError,
  RenderAttemptError,
} from './carousel-renderer.error';
import type { BrowserlessUsage } from './render-usage.types';
import { Slide } from './schemas';
import { htmlToPdf } from './utils/html-to-pdf.util';

const PDF_MIME_TYPE = 'application/pdf';
const BROWSERLESS_UNIT_MS = 30_000;

export const browserlessUnitsForDuration = (durationMs: number): number =>
  Math.max(1, Math.ceil(durationMs / BROWSERLESS_UNIT_MS));

/**
 * The R2 object key for a document version's rendered PDF. A whole-job retry
 * targets the same `(artifactId, version)`, so re-rendering PUTs this same key —
 * idempotent, no orphans.
 */
export const documentPdfKey = (artifactId: string, version: number): string =>
  `artifacts/${artifactId}/${version}/document.pdf`;

/**
 * Turns validated slides into a LinkedIn-document PDF in R2, fulfilling the
 * `CarouselRenderer` role (R3) so `RENDER_PDF` mocks as trivially as every other
 * step. The pipeline is `assembleHtml → htmlToPdf → uploadFile`, run once per
 * render — the whole deck is one HTML document rendered in one Browserless call,
 * never a per-slide round-trip.
 *
 * **Stores the key, not a URL (R1).** The R2 bucket is private, so `uploadFile`
 * returns an `…r2.cloudflarestorage.com` URL nothing can serve to a client; the
 * caller persists `pdfKey` and signs on read.
 */
@Injectable()
export class CarouselRendererService implements CarouselRenderer {
  constructor(private readonly templates: CarouselTemplatesService) {}

  async render(input: CarouselRenderInput): Promise<VersionRender> {
    const html = this.assembleHtml(input.templateId, input.slides);
    const browserlessStartedAt = Date.now();
    let pdf: Buffer;
    try {
      pdf = await this.htmlToPdf(html);
    } catch (error: unknown) {
      const browserless = this.browserlessUsageSince(browserlessStartedAt);
      throw new RenderAttemptError(
        error instanceof Error ? error.message : String(error),
        browserless,
        'browserless',
        error,
      );
    }
    const browserless = this.browserlessUsageSince(browserlessStartedAt);
    const pdfKey = documentPdfKey(input.artifactId, input.version);
    try {
      await this.uploadFile(pdfKey, pdf, PDF_MIME_TYPE);
    } catch (error: unknown) {
      throw new RenderAttemptError(
        error instanceof Error ? error.message : String(error),
        browserless,
        'upload',
        error,
      );
    }
    // The page box matches the slide box exactly, so `pageCount = slides.length`
    // is true by construction — no need to count pages in the returned PDF.
    return {
      pdfKey,
      pageCount: input.slides.length,
      browserless,
    };
  }

  private browserlessUsageSince(startedAt: number): BrowserlessUsage {
    const durationMs = Math.max(0, Date.now() - startedAt);
    return { durationMs, units: browserlessUnitsForDuration(durationMs) };
  }

  /**
   * Pure, no I/O: delegates to the precompiled templates. Assembly's only failure
   * mode is an unknown theme or slide type; both are re-raised as
   * `CarouselAssemblyError` so the step can mark them terminal (a cold replay
   * cannot fix content that already passed Zod at `GENERATE`).
   */
  assembleHtml(templateId: CarouselTheme, slides: readonly unknown[]): string {
    try {
      // Zod validated `slides` against the DOCUMENT arm at `GENERATE`; the role
      // interface widens them to `unknown[]` only so the engine need not know
      // the carousel shape.
      return this.templates.assembleHtml(templateId, slides as Slide[]);
    } catch (error) {
      throw new CarouselAssemblyError((error as Error).message, error);
    }
  }

  /**
   * Thin seams over the module-level network halves. They exist so a unit test
   * can stub Browserless and R2 while exercising the real, pure `assembleHtml`.
   */
  protected htmlToPdf(html: string): Promise<Buffer> {
    return htmlToPdf(html);
  }

  protected uploadFile(
    key: string,
    body: Buffer,
    mimeType: string,
  ): Promise<string> {
    return uploadFile(key, body, mimeType);
  }
}
