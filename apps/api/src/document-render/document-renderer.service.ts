import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DesignSystemDefinition } from '../design-system/design-system-definition';
import type { DocumentRenderer } from '../workflow/engine/workflow.types';
import { judge } from './judge';
import { RenderSessionError } from './render-session.error';
import { RenderSlots } from './render-slots';
import {
  browserlessEndpoint,
  renderDocumentSession,
  type RenderSessionOptions,
  type RenderSessionResult,
} from './render-session';

/** What a caller bounds about one render. */
export interface DocumentRenderOptions {
  /**
   * The longest the render may wait for a Browserless slot; the semaphore's
   * own `BROWSERLESS_SLOT_WAIT_MAX_MS` still applies. Unbounded by default.
   */
  maxSlotWaitMs?: number;
}

/**
 * The `DocumentRenderer` role `RENDER_PDF` consumes: one CDP session per call
 * against Browserless (spec §5.1). Configuration is read per call, so the API
 * process, which never renders, boots without Browserless credentials.
 *
 * Each session holds a Browserless slot (`RenderSlots`) from just before it
 * connects until it ends, so concurrent renders across workers stay within
 * the plan's limit and wait instead of being refused.
 */
@Injectable()
export class DocumentRendererService implements DocumentRenderer {
  constructor(
    private readonly config: ConfigService,
    private readonly slots: RenderSlots,
  ) {}

  /**
   * Renders one Document Source. The result, or a `RenderSessionError`,
   * carries `slotWaitMs`; a `RenderSlotUnavailableError` means no session ran.
   */
  async render(
    definition: DesignSystemDefinition,
    documentSource: string,
    { maxSlotWaitMs = Infinity }: DocumentRenderOptions = {},
  ): Promise<RenderSessionResult> {
    const endpoint = this.endpoint();
    // Taken before `connect` and the session clock, so waiting for a slot
    // never counts against the session deadline.
    const slot = await this.slots.acquire(maxSlotWaitMs);
    let disconnected: Promise<void> = Promise.resolve();
    try {
      const result = await this.renderSession(
        endpoint,
        definition,
        documentSource,
        {
          // A session with findings goes to Repair, so its cover would be thrown away.
          skipCover: (facts) => judge(definition, facts).length > 0,
          onDisconnect: (closing) => {
            disconnected = closing;
          },
        },
      );
      return { ...result, slotWaitMs: slot.waitedMs };
    } catch (error: unknown) {
      if (error instanceof RenderSessionError) error.slotWaitMs = slot.waitedMs;
      throw error;
    } finally {
      // The result does not wait for the disconnect, but the slot does:
      // Browserless counts the session until its socket closes.
      void disconnected.then(() => slot.release());
    }
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
    options: RenderSessionOptions,
  ): Promise<RenderSessionResult> {
    return renderDocumentSession(endpoint, definition, documentSource, options);
  }
}
