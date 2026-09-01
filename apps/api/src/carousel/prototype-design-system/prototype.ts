/**
 * PROTOTYPE — Design System Definition contract (issue #160). Throwaway.
 *
 * Run:  bun src/carousel/prototype-design-system/prototype.ts
 *
 * The question: what belongs in the YAML so it is expressive for the model and
 * enforceable by the backend? Every menu item below is one side of that.
 */
import { parseDesignSystem, type DesignSystem } from './contract';
import { renderPromptFragment } from './prompt';
import { contrastReport, enforce } from './enforce';
import { ledger, teethLabel } from './ledger';

const dir = import.meta.dir;
const read = (f: string) => Bun.file(`${dir}/${f}`).text();

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

// Strict palette references are the settled contract (#160); the toggle exists
// only to show what the looser alternative would have let through.
let strict = true;
let ds: DesignSystem;

const rule = (t = '') =>
  console.log(c.dim('-'.repeat(78)) + (t ? `\n${c.bold(t)}` : ''));

async function load() {
  const result = parseDesignSystem(await read('editorial-serif.ds.yaml'));
  if (!result.success) {
    console.error(
      c.red('editorial-serif.ds.yaml does not parse:'),
      result.error.issues,
    );
    process.exit(1);
  }
  ds = result.data;
}

async function showYaml() {
  rule('editorial-serif.ds.yaml');
  console.log(await read('editorial-serif.ds.yaml'));
}

async function showParse() {
  rule('Parse boundary — a definition the backend cannot enforce never seeds');
  const bad = parseDesignSystem(await read('samples/broken.ds.yaml'));
  if (bad.success) return console.log('unexpectedly valid');
  console.log(c.red(`broken.ds.yaml — ${bad.error.issues.length} issues:\n`));
  for (const i of bad.error.issues)
    console.log(`  ${c.yellow(i.path.join('.') || '(root)')}: ${i.message}`);
  console.log(`\n${c.green('editorial-serif.ds.yaml — valid.')}`);
  rule('Definition-time contrast check (palette.pairings)');
  for (const r of contrastReport(ds))
    console.log(
      `  ${r.pass ? c.green('pass') : c.red('FAIL')}  ${r.pair.padEnd(24)} ${r.ratio.toFixed(2)}:1`,
    );
}

function showPrompt() {
  const text = renderPromptFragment(ds);
  rule('What the model reads');
  console.log(text);
  rule();
  console.log(
    c.dim(
      `${text.length} chars, ~${Math.round(text.length / 4)} tokens — the standing cost of this system on every generation and every repair.`,
    ),
  );
}

async function showEnforce() {
  for (const file of ['samples/conforming.html', 'samples/drifted.html']) {
    const v = enforce(ds, await read(file), { strict });
    rule(
      `${file}  ${c.dim(strict ? '[contract: strict palette]' : '[rejected alternative: loose palette]')}`,
    );
    if (!v.length) console.log(c.green('  no violations'));
    for (const x of v)
      console.log(
        `  ${c.red('x')} ${c.yellow(x.rule)}${x.page ? c.dim(` p${x.page}`) : ''}: ${x.detail}`,
      );
  }
  rule();
  console.log(
    c.dim(
      'Still invisible to these checks: safe-area overflow, actual contrast used, line length, and every composition rule. Those are #163 render checks or nothing.',
    ),
  );
}

function showLedger() {
  rule('Every contract key, by who consumes it');
  for (const group of ['static', 'render', 'seed', 'guidance'] as const) {
    console.log(`\n${c.bold(teethLabel[group])}`);
    for (const l of ledger.filter((x) => x.teeth === group))
      console.log(
        `  ${l.prompt ? c.cyan('prompt') : c.dim('  --  ')}  ${l.key.padEnd(38)} ${c.dim(l.note)}`,
      );
  }
  rule();
  console.log(
    c.dim(
      '"prompt" = the key also becomes text the model reads. Keys with neither column are dead weight and should be cut.',
    ),
  );
}

const menu = `
${c.bold('Design System Definition contract — prototype (#160)')}
  1  the YAML
  2  parse boundary + contrast check
  3  what the model reads
  4  what the backend rejects
  5  ledger: enforced vs guidance
  6  toggle the palette rule  ${c.dim('(contract = var(--ds-*) only; off = bare hex allowed)')}
  q  quit
`;

await load();
console.log(menu);
for await (const line of console) {
  const k = line.trim().toLowerCase();
  if (k === 'q') break;
  if (k === '1') await showYaml();
  else if (k === '2') await showParse();
  else if (k === '3') showPrompt();
  else if (k === '4') await showEnforce();
  else if (k === '5') showLedger();
  else if (k === '6') {
    strict = !strict;
    console.log(
      `palette rule: ${strict ? c.green('token-var-only (the contract)') : c.yellow('loose hex (the rejected alternative)')}`,
    );
  } else console.log(menu);
  console.log(c.dim('\n[1-6, q]'));
}
