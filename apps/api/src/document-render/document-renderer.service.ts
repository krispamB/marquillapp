import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DesignSystemDefinition } from '../design-system/design-system-definition';
import type { DocumentRenderer } from '../workflow/engine/workflow.types';
import {
  browserlessEndpoint,
  renderDocumentSession,
  type RenderSessionResult,
} from './render-session';

/**
 * The `DocumentRenderer` role `RENDER_PDF` consumes: one CDP session per call
 * against Browserless (spec §5.1). Configuration is read per call, so the API
 * process, which never renders, boots without Browserless credentials.
 */
@Injectable()
export class DocumentRendererService implements DocumentRenderer {
  constructor(private readonly config: ConfigService) {}

  async render(
    definition: DesignSystemDefinition,
    documentSource: string,
  ): Promise<RenderSessionResult> {
    return this.renderSession(this.endpoint(), definition, documentSource);
  }

  private endpoint(): string {
    return browserlessEndpoint(
      this.config.getOrThrow<string>('BROWSERLESS_URL'),
      this.config.getOrThrow<string>('BROWSERLESS_TOKEN'),
    );
  }

  /** A seam over the network half, so a unit test can stub the session. */
  protected renderSession(
    endpoint: string,
    definition: DesignSystemDefinition,
    documentSource: string,
  ): Promise<RenderSessionResult> {
    return renderDocumentSession(endpoint, definition, documentSource);
  }
}
