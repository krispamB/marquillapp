/**
 * PROTOTYPE — render validation and repair diagnostics (issue #163). Throwaway.
 *
 * Run:  bun src/carousel/prototype-render-validation/prototype.ts [--browserless]
 *
 * The question: how should Browserless load, inspect and render a Document
 * Source so it can prove geometry, font readiness, overflow safety and PDF page
 * count, and hand back bounded repair diagnostics without executing untrusted
 * content? Each menu item renders one Candidate Source and shows what the
 * session measured, what the judge found, and what the model would be told.
 *
 * Locally this launches puppeteer's cached Chrome and costs nothing.
 * `--browserless` runs the identical session against BROWSERLESS_URL, one
 * session per render, which spends real units (measured: ~13-17s, one unit,
 * per 2-4 page document). Item 8 is ten renders.
 */
import type { Browser } from 'puppeteer-core';
import {
  parseDesignSystem,
  type DesignSystem,
} from '../prototype-design-system/contract';
import { assemble } from './assemble';
import { boundForModel, remedyOf } from './diagnostics';
import { judge } from './judge';
import {
  openBrowser,
  renderAndInspect,
  type BrowserMode,
  type RenderOptions,
} from './session';

const dir = import.meta.dir;
const mode: BrowserMode = process.argv.includes('--browserless')
  ? 'browserless'
  : 'local';

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};
const rule = (t = '') =>
  console.log(c.dim('-'.repeat(78)) + (t ? `\n${c.bold(t)}` : ''));

const parsed = parseDesignSystem(
  await Bun.file(
    `${dir}/../prototype-design-system/editorial-serif.ds.yaml`,
  ).text(),
);
if (!parsed.success) throw parsed.error;
const ds: DesignSystem = parsed.data;

// Locally one Chrome serves every menu item. Against Browserless each render
// gets its own session, as production would: one document, one session, one
// metered render — and no run outlives the service's session timeout.
let local: Browser | null = null;
const withSession = async <T>(fn: (b: Browser) => Promise<T>): Promise<T> => {
  if (mode === 'local') return fn((local ??= await openBrowser('local')));
  const startedAt = Date.now();
  const b = await openBrowser('browserless');
  try {
    return await fn(b);
  } finally {
    await b.close();
    const ms = Date.now() - startedAt;
    console.log(
      c.dim(
        `session ${ms}ms = ${Math.max(1, Math.ceil(ms / 30_000))} unit(s) at 30s/unit`,
      ),
    );
  }
};

async function show(sample: string, why: string, opts: RenderOptions = {}) {
  const candidate = await Bun.file(`${dir}/samples/${sample}.html`).text();
  const documentSource = assemble(ds, candidate);
  const r = await withSession((b) =>
    renderAndInspect(b, ds, documentSource, opts),
  );
  const found = judge(ds, r.facts);

  rule(
    `${sample}.html${opts.simulateFontOutage ? ' — with fonts.gstatic.com refused' : ''}`,
  );
  console.log(c.dim(why));
  const t = r.timings;
  console.log(
    c.dim(
      `load ${t.loadMs}ms · probe ${t.probeMs}ms · fonts ${t.fontsMs}ms · pdf ${t.pdfMs}ms · ` +
        `${r.facts.pages.length} page elements · PDF ${r.facts.pdfPageCount ?? '—'} pages · ` +
        `${r.requests.allowed.length} requests allowed, ${r.requests.blocked.length} refused · ` +
        `script ran: ${r.facts.scriptRan ? c.red('YES') : 'no'}`,
    ),
  );
  if (!found.length) console.log(c.green('  no findings'));
  for (const v of found) {
    const remedy = remedyOf(v.code);
    const tag =
      remedy === 'repair'
        ? c.dim('repair')
        : remedy === 'retry'
          ? c.yellow('retry ')
          : c.red('defect');
    console.log(
      `  ${tag} ${c.yellow(v.code)}${v.page ? c.dim(` p${v.page}`) : ''}: ${v.detail}`,
    );
  }
  const prompt = boundForModel(found);
  if (prompt) {
    console.log(`\n${c.cyan('What the repair prompt carries:')}`);
    console.log(prompt);
  }
  return r;
}

/** The pagination breakers found while building this, against both frames. */
async function pagination() {
  const breakers: Record<string, string> = {
    'abs far': '.label { position: absolute; top: 6000px; }',
    'abs near': '.ask { position: absolute; top: 200px; }',
    'forced break': '.lead { break-before: page; }',
    'tall child': '.lead { height: 3000px; }',
    'body height': 'body { height: 20000px; }',
  };
  rule('Pagination: what a model-authored rule can do to the PDF, per frame');
  const base = await Bun.file(`${dir}/samples/conforming.html`).text();
  for (const [frame, swap] of [
    [
      'overflow: hidden only',
      (h: string) => h.replace('contain: strict; ', ''),
    ],
    ['+ contain: strict (the frame)', (h: string) => h],
  ] as const) {
    const row: string[] = [];
    for (const [name, css] of Object.entries(breakers)) {
      const html = swap(
        assemble(ds, base.replace('</style>', `${css}\n</style>`)),
      );
      const r = await withSession((b) => renderAndInspect(b, ds, html));
      const pdf = r.facts.pdfPageCount;
      const codes = [...new Set(judge(ds, r.facts).map((v) => v.code))];
      row.push(
        `${name}: ${pdf === 4 ? c.green(`${pdf}pp`) : c.red(`${pdf}pp`)} ${c.dim(codes.join(',') || 'clean')}`,
      );
    }
    console.log(`\n${c.bold(frame)}\n  ${row.join('\n  ')}`);
  }
  console.log(
    c.dim(
      '\nThe frame closes every breaker but one: `body { height }` sits outside the pages, and only the\nPDF page count sees it. That is why the count is checked even though the frame makes it true\nfor everything the pages themselves can do.',
    ),
  );
}

const menu = `
${c.bold('Render validation and repair diagnostics — prototype (#163)')}  ${c.dim(`[${mode}]`)}
  1  conforming            the baseline: every check silent
  2  overflow              on-scale CSS the static checker passes, that the render does not
  3  collision             overlap and a blank page
  4  colour                pairings and icon colour, only knowable after the cascade
  5  glyphs                emoji and Devanagari: fallback per glyph, not per family
  6  font outage           conforming, with Google's font files refused
  7  hostile               script, url(), <img>: the session as the second wall
  8  pagination            frame containment vs model-authored breakers
  q  quit
`;

console.log(menu);
try {
  for await (const line of console) {
    const k = line.trim().toLowerCase();
    if (k === 'q') break;
    if (k === '1')
      await show(
        'conforming',
        'A Candidate Source that obeys #162 and the Design System.',
      );
    else if (k === '2')
      await show(
        'overflow',
        'transform: translateX(-48px), a fixed-height overflow: hidden box, and one paragraph too many.',
      );
    else if (k === '3')
      await show(
        'collision',
        'An absolutely positioned eyebrow over the headline, and a page holding only a rule.',
      );
    else if (k === '4')
      await show(
        'colour',
        'Every colour is a valid var(--ds-*) token. The pairs they form are not.',
      );
    else if (k === '5')
      await show(
        'glyphs',
        'The families loaded fine; some characters are not in them.',
      );
    else if (k === '6')
      await show(
        'conforming',
        "Not the model's fault, so nothing reaches the repair prompt.",
        { simulateFontOutage: true },
      );
    else if (k === '7')
      await show(
        'hostile',
        'Rejected statically in production; rendered here to show nothing runs and nothing leaves.',
      );
    else if (k === '8') await pagination();
    else console.log(menu);
    console.log(c.dim('\n[1-8, q]'));
  }
} finally {
  await (local as Browser | null)?.close();
}
