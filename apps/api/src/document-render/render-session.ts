import puppeteer, { type Browser, type HTTPRequest } from 'puppeteer-core';
import type { BrowserlessUsage } from './render-usage.types';
import type { DesignSystemDefinition } from '../design-system/design-system-definition';
import { isFontRequest } from '../document-source/assemble';
import {
  BROWSERLESS_SESSION_GRACE_MS,
  BROWSERLESS_UNIT_MS,
  RENDER_SESSION_DEADLINE_MS,
  RENDER_SNIPPET_LENGTH,
} from './document-render.constants';
import { countPdfPages } from './pdf-page-count';
import { RenderSessionError } from './render-session.error';
import { PROBE_ELEMENT_SELECTOR, probeInPage } from './probe';

export { RenderSessionError } from './render-session.error';
import {
  emptyRenderFacts,
  type PlatformFont,
  type RenderFacts,
} from './render-facts';

export interface RenderSessionOptions {
  /** Overrides `RENDER_SESSION_DEADLINE_MS`; for tests. */
  deadlineMs?: number;
}

/** `cover.png` of page 1, or why it could not be captured (§5.1 step 7). */
export type CoverCapture =
  | { ok: true; png: Uint8Array }
  | { ok: false; reason: string };

export interface RenderSessionResult {
  /** What the probe, the font pass and the print measured; `judge()` input. */
  facts: RenderFacts;
  /** The printed PDF, or `null` when the session timed out before printing. */
  pdf: Uint8Array | null;
  /** Pages in `pdf`, or `null` without one. */
  pageCount: number | null;
  /** Best effort: a failed capture never fails the render. */
  cover: CoverCapture;
  /** Requests the session refused (also in `facts`). */
  refusedRequests: string[];
  /** Wall time from connect to disconnect, and the Browserless units it costs. */
  usage: BrowserlessUsage;
}

/**
 * The Browserless WebSocket endpoint for one session. Browserless's own
 * `timeout` is a backstop: it closes a session the app lost track of shortly
 * after the app's own deadline.
 */
export function browserlessEndpoint(
  baseUrl: string,
  token: string,
  deadlineMs: number = RENDER_SESSION_DEADLINE_MS,
): string {
  const url = new URL(baseUrl.replace(/^http/, 'ws'));
  url.searchParams.set('token', token);
  url.searchParams.set(
    'timeout',
    String(deadlineMs + BROWSERLESS_SESSION_GRACE_MS),
  );
  return url.toString();
}

const TIMED_OUT = Symbol('timed out');

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * One render of a Document Source (§5.1): one `puppeteer.connect` session, one
 * metered render. In order: JavaScript off; requests allowlisted to the Google
 * Fonts stylesheet and font files, with every refusal recorded; print media
 * and a viewport at the page size; `setContent` until `load`; the probe; the
 * font pass; a best-effort `cover.png` of page 1; `page.pdf` and its page
 * count. One deadline covers all of it, connect included.
 *
 * It measures and never decides: pass `result.facts` to `judge()`. A deadline
 * expiry is a fact (`timedOut`), not an error. Anything else that stops the
 * session throws `RenderSessionError`.
 */
export async function renderDocumentSession(
  browserWSEndpoint: string,
  definition: DesignSystemDefinition,
  documentSource: string,
  options: RenderSessionOptions = {},
): Promise<RenderSessionResult> {
  const { width, height } = definition.page;
  const deadlineMs = options.deadlineMs ?? RENDER_SESSION_DEADLINE_MS;
  const startedAt = Date.now();
  const facts = emptyRenderFacts();
  let pdf: Uint8Array | null = null;
  let cover: CoverCapture = {
    ok: false,
    reason: 'the session ended before page 1 was captured',
  };
  let browser: Browser | undefined;
  let expired = false;

  const session = async (): Promise<void> => {
    const connected = await puppeteer.connect({ browserWSEndpoint });
    browser = connected;
    if (expired) {
      // The deadline won the race to connect; never leave a session open.
      await connected.disconnect();
      return;
    }
    const page = await connected.newPage();

    // 1. Untrusted content never executes. CDP evaluation still runs the probe.
    await page.setJavaScriptEnabled(false);

    // 2. The second wall behind the static `url(` rule: only the font
    // stylesheet and the font files it references may load.
    await page.setRequestInterception(true);
    page.on('request', (request: HTTPRequest) => {
      if (request.isInterceptResolutionHandled()) return;
      const url = request.url();
      if (isFontRequest(url)) {
        request.continue().catch(() => undefined);
      } else {
        // Chrome may ask twice for one URL (preload scanner, then parser).
        if (!facts.refusedRequests.includes(url))
          facts.refusedRequests.push(url);
        request.abort('blockedbyclient').catch(() => undefined);
      }
    });

    // 3. Measure the layout the PDF gets, not the screen one.
    await page.emulateMediaType('print');
    await page.setViewport({ width, height });

    // 4. `load`, not `networkidle0`, which never settles on Browserless. Font
    // readiness is proven by the probe and the font pass instead. The session
    // deadline bounds this, so the per-call timeout is off.
    await page.setContent(documentSource, { waitUntil: 'load', timeout: 0 });

    // 5. The probe.
    const probed = await page.evaluate(
      probeInPage,
      PROBE_ELEMENT_SELECTOR,
      RENDER_SNIPPET_LENGTH,
    );
    facts.pages = probed.pages;
    facts.elements = probed.elements;
    facts.faces = probed.faces;

    // 6. The font pass: which font actually painted each element's glyphs.
    // `document.fonts.check()` cannot tell: it is true for a missing family.
    const cdp = await page.createCDPSession();
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector: PROBE_ELEMENT_SELECTOR,
    });
    const withText = facts.elements.filter((e) => e.textRects.length > 0);
    const fonts = await Promise.all(
      withText.map((e) =>
        cdp.send('CSS.getPlatformFontsForNode', { nodeId: nodeIds[e.idx] }),
      ),
    );
    withText.forEach((e, i) => {
      facts.platformFonts[e.idx] = fonts[i].fonts as PlatformFont[];
    });
    await cdp.detach();

    // 7. Best effort: a cover that fails to capture never blocks READY.
    try {
      const png = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width, height },
      });
      cover = { ok: true, png };
    } catch (error) {
      cover = { ok: false, reason: reasonOf(error) };
    }

    // 8. Print, then count what printed.
    pdf = await page.pdf({
      width: `${width}px`,
      height: `${height}px`,
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      timeout: 0,
    });
    facts.pdfPageCount = countPdfPages(pdf);
  };

  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), deadlineMs);
  });
  const work = session();
  // Once the deadline wins, the abandoned session rejects as it is torn down.
  work.catch(() => undefined);

  let failure: unknown;
  try {
    if ((await Promise.race([work, deadline])) === TIMED_OUT) {
      expired = true;
      facts.timedOut = true;
    }
  } catch (error) {
    failure = error;
  } finally {
    clearTimeout(timer);
  }
  // Disconnecting ends the Browserless session; locally it leaves the browser up.
  await browser?.disconnect().catch(() => undefined);

  const durationMs = Date.now() - startedAt;
  const usage: BrowserlessUsage = {
    durationMs,
    units: Math.max(1, Math.ceil(durationMs / BROWSERLESS_UNIT_MS)),
  };
  if (failure !== undefined) {
    throw new RenderSessionError(
      `render session failed: ${reasonOf(failure)}`,
      usage,
      { cause: failure },
    );
  }
  if (facts.timedOut) {
    pdf = null;
    facts.pdfPageCount = null;
  }

  return {
    facts,
    pdf,
    pageCount: facts.pdfPageCount,
    cover,
    refusedRequests: [...facts.refusedRequests],
    usage,
  };
}
