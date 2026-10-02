/**
 * PROTOTYPE — six candidate default Design Systems, issue #140. Throwaway.
 *
 * Plan: six contract-v1 definitions, each with a hand-written sample Document
 * Source on the same topic, switchable via `?variant=<id>` on one local page,
 * plus `?variant=overview` to compare every cover side by side.
 *
 * Every definition goes through the production parse boundary, every sample
 * through the production checker (#160), and every render through production
 * assembly (#161), so what you see is also what would pass.
 *
 * The definitions and samples were kept (see #140) and now live in
 * `assets/design-systems/<id>/`; this server only reads them.
 *
 *   bun src/carousel/prototype-design-systems/preview.ts            (from apps/api)
 *   bun src/carousel/prototype-design-systems/preview.ts --check    parse + checker only
 *   bun src/carousel/prototype-design-systems/preview.ts --render   rewrite previews/*.png
 */
import {
  parseDesignSystemDefinition,
  type DesignSystemDefinition as DesignSystem,
} from '../../design-system/design-system-definition';
import { renderPromptFragment } from '../../design-system/prompt-fragment';
import { assemble } from '../../document-source/assemble';
import { check } from '../../document-source/candidate-check';
import type { Violation } from '../../document-source/violation';

/** Definition-time check: do the declared pairings clear the contrast floor? */
function contrastReport(ds: DesignSystem) {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const hex = (name: string) =>
    ds.palette.tokens.find((t) => t.name === name)!.hex;
  return ds.palette.pairings.map((p) => {
    const [a, b] = [lum(hex(p.text)), lum(hex(p.on))].sort((x, y) => y - x);
    const ratio = (a + 0.05) / (b + 0.05);
    return {
      pair: `${p.text} on ${p.on}`,
      ratio,
      pass: ratio >= ds.palette.rules.minContrastRatio,
    };
  });
}

const IDS = [
  'broadside',
  'colophon',
  'margin',
  'afterglow',
  'overprint',
  'schematic',
] as const;
const PORT = Number(process.env.PORT ?? 4140);
const ASSETS = `${import.meta.dir}/../../../assets/design-systems`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PREVIEW_WIDTH = 540;

type Loaded = {
  id: string;
  ds?: DesignSystem;
  errors: string[];
  source: string;
  violations: Violation[];
  contrast: ReturnType<typeof contrastReport>;
  promptTokens: number;
};

async function load(id: string): Promise<Loaded> {
  const yaml = await Bun.file(`${ASSETS}/${id}/definition.ds.yaml`).text();
  const source = await Bun.file(`${ASSETS}/${id}/sample.html`).text();
  const parsed = parseDesignSystemDefinition(yaml);
  if (!parsed.success)
    return {
      id,
      errors: parsed.errors,
      source,
      violations: [],
      contrast: [],
      promptTokens: 0,
    };
  const ds = parsed.definition;
  return {
    id,
    ds,
    errors: [],
    source,
    violations: check(ds, source),
    contrast: contrastReport(ds),
    promptTokens: Math.round(renderPromptFragment(ds).length / 4),
  };
}

/** Preview-only chrome inside the iframe: lay pages out as a scaled strip. */
const frame = (ds: DesignSystem, source: string, zoom: number, onlyFirst = false) =>
  assemble(ds, source).replace(
    '</head>',
    `<style>
      html, body { background: #1b1b1f !important; }
      body { display: flex; flex-wrap: wrap; gap: 64px; padding: 64px !important; zoom: ${zoom}; }
      .page { flex: none; box-shadow: 0 20px 60px #0008; }
      ${onlyFirst ? '.page ~ .page { display: none !important; }' : ''}
    </style></head>`,
  );

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

function detail(l: Loaded) {
  const ds = l.ds!;
  const swatches = ds.palette.tokens
    .map(
      (t) =>
        `<div class="sw"><span style="background:${t.hex}"></span><b>${t.name}</b><code>${t.hex}</code><i>${t.role}</i></div>`,
    )
    .join('');
  const fonts = ds.typography.fonts
    .map((f) => `<li><b>${f.family}</b> <i>${f.weights.join('/')}</i></li>`)
    .join('');
  const scale = ds.typography.scale
    .map((s) => `<li><code>${s.px}px</code> ${s.name} <i>(${s.font})</i></li>`)
    .join('');
  const roles = ds.composition.pageRoles
    .map((r) => `<li><b>${r.name}</b>${r.position !== 'any' ? ` <i>${r.position}</i>` : ''}</li>`)
    .join('');
  const contrast = l.contrast
    .map(
      (c) =>
        `<li class="${c.pass ? 'ok' : 'bad'}">${c.pair} <code>${c.ratio.toFixed(1)}:1</code></li>`,
    )
    .join('');
  const violations = l.violations.length
    ? `<ul class="bad">${l.violations.map((v) => `<li>${v.page ? `p${v.page} ` : ''}<b>${v.code}</b> ${esc(v.detail)}</li>`).join('')}</ul>`
    : '<p class="ok">0 violations against its own definition</p>';
  return `
    <aside>
      <h1>${ds.name}</h1>
      <p class="id"><code>${ds.id}@${ds.version}</code> · ~${l.promptTokens} prompt tokens</p>
      <p>${esc(ds.summary)}</p>
      <p class="intent">${esc(ds.intent)}</p>
      <h2>Checker</h2>${violations}
      <h2>Palette</h2>${swatches}
      <h2>Contrast (pairings)</h2><ul>${contrast}</ul>
      <h2>Fonts</h2><ul>${fonts}</ul>
      <h2>Type scale</h2><ul>${scale}</ul>
      <h2>Page roles</h2><ul>${roles}</ul>
    </aside>
    <main><iframe srcdoc="${esc(frame(ds, l.source, 0.3))}"></iframe></main>`;
}

function overview(all: Loaded[]) {
  const cells = all
    .map(
      (l) => `<a class="cell" href="?variant=${l.id}">
        ${l.ds ? `<iframe srcdoc="${esc(frame(l.ds, l.source, 0.3, true))}" tabindex="-1"></iframe>` : ''}
        <b>${l.ds?.name ?? l.id}</b><span>${esc(l.ds?.summary ?? l.errors.join('; '))}</span>
        <em class="${l.violations.length || l.errors.length ? 'bad' : 'ok'}">${l.errors.length ? 'definition does not parse' : `${l.violations.length} violations`}</em>
      </a>`,
    )
    .join('');
  return `<div class="grid">${cells}</div>`;
}

const VARIANTS = ['overview', ...IDS];

async function page(variant: string) {
  const all = await Promise.all(IDS.map(load));
  const current = all.find((l) => l.id === variant);
  const body = current
    ? current.errors.length
      ? `<aside><h1>${current.id}</h1><ul class="bad">${current.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></aside>`
      : detail(current)
    : overview(all);
  const label = current?.ds?.name ?? (current ? current.id : 'Overview');
  return `<!doctype html><html><head><meta charset="utf-8"><title>#140 · ${label}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 -apple-system, system-ui, sans-serif; background: #1b1b1f; color: #e8e8ea; display: flex; height: 100vh; }
  aside { width: 380px; flex: none; overflow: auto; padding: 24px 24px 96px; background: #111114; border-right: 1px solid #2a2a30; }
  aside h1 { margin: 0; font-size: 28px; } aside h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #8a8a94; margin: 24px 0 8px; }
  aside ul { margin: 0; padding: 0 0 0 16px; } .id { color: #8a8a94; margin: 4px 0 12px; } .intent { color: #a8a8b2; font-size: 13px; }
  i { color: #8a8a94; font-style: normal; } code { font-size: 12px; color: #c9c9d1; }
  .sw { display: grid; grid-template-columns: 28px 1fr auto; gap: 0 8px; align-items: center; margin: 4px 0; }
  .sw span { width: 28px; height: 28px; border-radius: 6px; grid-row: span 2; border: 1px solid #fff2; } .sw i { grid-column: 2; font-size: 12px; }
  .ok { color: #7ee2a8; } .bad { color: #ff8d8d; }
  main { flex: 1; } main iframe { width: 100%; height: 100%; border: 0; }
  .grid { flex: 1; overflow: auto; display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px; padding: 32px 32px 120px; }
  .cell { color: inherit; text-decoration: none; display: flex; flex-direction: column; gap: 4px; }
  .cell iframe { width: 362px; height: 444px; border: 0; pointer-events: none; border-radius: 8px; overflow: hidden; }
  .cell b { font-size: 20px; } .cell span { color: #a8a8b2; font-size: 13px; } .cell em { font-style: normal; font-size: 12px; }
  .cell:hover b { text-decoration: underline; }
  .switcher { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 4px; background: #fff; color: #111; border-radius: 999px; padding: 6px; box-shadow: 0 8px 30px #0009; font-weight: 600; z-index: 10; }
  .switcher button { border: 0; background: #eee; border-radius: 999px; width: 36px; height: 36px; cursor: pointer; font-size: 16px; }
  .switcher span { padding: 0 16px; min-width: 220px; text-align: center; }
</style></head><body>
${body}
<div class="switcher">
  <button id="prev" aria-label="Previous">&larr;</button>
  <span>${VARIANTS.indexOf(variant) === -1 ? 0 : VARIANTS.indexOf(variant)} — ${label}</span>
  <button id="next" aria-label="Next">&rarr;</button>
</div>
<script>
  const V = ${JSON.stringify(VARIANTS)};
  const cur = Math.max(0, V.indexOf(new URLSearchParams(location.search).get('variant') ?? 'overview'));
  const go = (d) => { location.search = '?variant=' + V[(cur + d + V.length) % V.length]; };
  document.getElementById('prev').onclick = () => go(-1);
  document.getElementById('next').onclick = () => go(1);
  addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input,textarea,[contenteditable]')) return;
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'ArrowRight') go(1);
  });
</script>
</body></html>`;
}

/**
 * One PNG per page, rendered by local Chrome at 1080x1350 and downscaled for
 * the UI. Stand-in until the #137 Browserless render path produces them.
 */
async function render() {
  const tmp = `${process.env.TMPDIR ?? '/tmp'}/ds-previews`;
  await Bun.$`mkdir -p ${tmp}`.quiet();
  for (const id of IDS) {
    const { ds, source, errors, violations } = await load(id);
    if (errors.length || violations.length)
      throw new Error(`${id} does not pass its own definition; run --check`);
    const pages = (source.match(/<section[^>]*class="[^"]*\bpage\b/g) ?? []).length;
    const out = `${ASSETS}/${id}/previews`;
    await Bun.$`rm -rf ${out} && mkdir -p ${out}`.quiet();
    for (let n = 1; n <= pages; n++) {
      const html = `${tmp}/${id}-${n}.html`;
      await Bun.write(
        html,
        assemble(ds!, source).replace(
          '</head>',
          `<style>section.page:not(:nth-of-type(${n})) { display: none !important; }</style></head>`,
        ),
      );
      const png = `${out}/page-${String(n).padStart(2, '0')}.png`;
      await Bun.$`${CHROME} --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=8000 --window-size=1080,1350 --screenshot=${png} file://${html}`.quiet();
      await Bun.$`sips --resampleWidth ${PREVIEW_WIDTH} ${png}`.quiet();
    }
    console.log(`${id.padEnd(10)} ${pages} previews -> ${out}`);
  }
}

if (process.argv.includes('--render')) {
  await render();
} else if (process.argv.includes('--check')) {
  const all = await Promise.all(IDS.map(load));
  for (const l of all) {
    const failing = l.contrast.filter((c) => !c.pass).map((c) => c.pair);
    console.log(
      `${l.id.padEnd(10)} parse:${l.errors.length ? 'FAIL' : 'ok'}  violations:${l.violations.length}  contrast-fail:${failing.length}  ~${l.promptTokens} prompt tokens`,
    );
    for (const e of l.errors) console.log(`    ! ${e}`);
    for (const v of l.violations)
      console.log(`    - ${v.page ? `p${v.page} ` : ''}${v.code}: ${v.detail}`);
    for (const f of failing) console.log(`    - contrast: ${f}`);
  }
} else {
  Bun.serve({
    port: PORT,
    async fetch(req) {
      const variant =
        new URL(req.url).searchParams.get('variant') ?? 'overview';
      return new Response(await page(variant), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    },
  });
  console.log(`#140 design systems prototype: http://localhost:${PORT}/?variant=overview`);
}
