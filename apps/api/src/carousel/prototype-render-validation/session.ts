/**
 * PROTOTYPE — one browser session that renders, inspects and prints a Document
 * Source. Throwaway (issue #163).
 *
 * Today `htmlToPdf` POSTs to Browserless's REST `/pdf`, which returns bytes and
 * nothing else: no geometry, no font state, no way to inspect. This drives the
 * same browser over CDP instead (`puppeteer.connect` to Browserless's WebSocket,
 * with `puppeteer-core`, already a dependency), so the checks and the PDF come
 * out of one session, and one metered render.
 *
 * Locally it launches the Chrome puppeteer already cached, so the prototype
 * costs nothing to run. `--browserless` points the identical code at the real
 * service.
 */
import { homedir } from 'node:os';
import puppeteer, { type Browser, TimeoutError } from 'puppeteer-core';
import type { DesignSystem } from '../prototype-design-system/contract';
import { countPdfPages } from './pdf';
import { ELEMENT_SELECTOR, probeInPage } from './probe';
import type { PlatformFont, RenderFacts } from './types';

export type BrowserMode = 'local' | 'browserless';

const LOCAL_CHROME = `${homedir()}/.cache/puppeteer/chrome-headless-shell/mac_arm-148.0.7778.97/chrome-headless-shell-mac-arm64/chrome-headless-shell`;

export async function openBrowser(mode: BrowserMode): Promise<Browser> {
  if (mode === 'local')
    return puppeteer.launch({ executablePath: LOCAL_CHROME });
  const base = process.env.BROWSERLESS_URL;
  const token = process.env.BROWSERLESS_TOKEN;
  if (!base || !token)
    throw new Error('BROWSERLESS_URL and BROWSERLESS_TOKEN are required');
  const ws = base.replace(/^http/, 'ws').replace(/\/$/, '');
  // Browserless's own session timeout is the backstop for a hung render.
  return puppeteer.connect({
    browserWSEndpoint: `${ws}?token=${token}&timeout=60000`,
  });
}

/**
 * The network policy. #162 makes `url(` a rule about the Candidate Source; this
 * is the second wall, for whatever the checker misses. Only the Google Fonts
 * stylesheet and the font files it points at may load.
 */
const allowed = (url: string) => {
  const u = new URL(url);
  return (
    u.protocol === 'https:' &&
    ((u.hostname === 'fonts.googleapis.com' && u.pathname === '/css2') ||
      u.hostname === 'fonts.gstatic.com')
  );
};

export type RenderOptions = {
  timeoutMs?: number;
  /** Refuse font files, to show what a Google Fonts outage renders like. */
  simulateFontOutage?: boolean;
};

export type RenderResult = {
  facts: RenderFacts;
  pdf: Uint8Array | null;
  timings: { loadMs: number; probeMs: number; fontsMs: number; pdfMs: number };
  requests: { allowed: string[]; blocked: string[] };
};

export async function renderAndInspect(
  browser: Browser,
  ds: DesignSystem,
  documentSource: string,
  opts: RenderOptions = {},
): Promise<RenderResult> {
  const { width, height } = ds.page;
  const page = await browser.newPage();
  const requests = { allowed: [] as string[], blocked: [] as string[] };
  const timings = { loadMs: 0, probeMs: 0, fontsMs: 0, pdfMs: 0 };
  const facts: RenderFacts = {
    timedOut: false,
    pages: [],
    elements: [],
    faces: [],
    platformFonts: {},
    blockedRequests: [],
    scriptRan: false,
    pdfPageCount: null,
  };

  try {
    // Untrusted content never executes. The probe still runs: CDP evaluation
    // is not page script.
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      const outage =
        opts.simulateFontOutage && url.includes('fonts.gstatic.com');
      if (allowed(url) && !outage) {
        requests.allowed.push(url);
        void req.continue();
      } else {
        requests.blocked.push(url);
        if (!outage) facts.blockedRequests.push(url);
        void req.abort('blockedbyclient');
      }
    });
    // Measure the layout the PDF will have, not the screen one.
    await page.emulateMediaType('print');
    await page.setViewport({ width, height });

    // `load`, not `networkidle0` (what `htmlToPdf` uses today). Fraunces 600
    // and 700 are one variable-font file; Chrome requests it twice and serves
    // the second from memory cache, and over Browserless that intercepted
    // duplicate never finishes, so network-idle never comes. Font readiness is
    // proven in the probe instead (`document.fonts.ready`), and what painted is
    // proven by CDP below.
    let t = Date.now();
    try {
      await page.setContent(documentSource, {
        waitUntil: 'load',
        timeout: opts.timeoutMs ?? 20_000,
      });
    } catch (error) {
      if (!(error instanceof TimeoutError)) throw error;
      facts.timedOut = true;
      return { facts, pdf: null, timings, requests };
    }
    timings.loadMs = Date.now() - t;

    t = Date.now();
    const probed = await page.evaluate(probeInPage, ELEMENT_SELECTOR);
    Object.assign(facts, probed);
    timings.probeMs = Date.now() - t;

    // What actually painted each element's glyphs. `document.fonts.check()`
    // cannot answer this: it returns true for a family that does not exist.
    t = Date.now();
    const cdp = await page.createCDPSession();
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector: ELEMENT_SELECTOR,
    });
    const withText = facts.elements.filter((e) => e.textRects.length);
    const fonts = await Promise.all(
      withText.map((e) =>
        cdp.send('CSS.getPlatformFontsForNode', { nodeId: nodeIds[e.idx] }),
      ),
    );
    withText.forEach((e, i) => {
      facts.platformFonts[e.idx] = fonts[i].fonts as PlatformFont[];
    });
    await cdp.detach();
    timings.fontsMs = Date.now() - t;

    t = Date.now();
    const pdf = await page.pdf({
      width: `${width}px`,
      height: `${height}px`,
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    facts.pdfPageCount = countPdfPages(pdf);
    timings.pdfMs = Date.now() - t;

    return { facts, pdf, timings, requests };
  } finally {
    await page.close();
  }
}
