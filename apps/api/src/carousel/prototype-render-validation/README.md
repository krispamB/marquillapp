# PROTOTYPE — render validation and repair diagnostics

Throwaway. Answers issue #163: *how should Browserless load, inspect and render
a candidate Document Source so it can prove page count and geometry, font
readiness, overflow safety and PDF page count, then return useful bounded
repair diagnostics without executing untrusted content?*

Builds on #160's prototype (`../prototype-design-system`, whose `contract.ts`
and `editorial-serif.ds.yaml` it imports) and #162's settled contract. Not wired
into the app; excluded from `tsconfig.build.json` because it is Bun-only.

```
bun src/carousel/prototype-render-validation/prototype.ts                 # local Chrome, free
bun src/carousel/prototype-render-validation/prototype.ts --browserless   # real units
bun test src/carousel/prototype-render-validation                         # the judge, 35 tests
```

| file | what it is |
|---|---|
| `assemble.ts` | Candidate Source → Document Source: frame CSS, font `<link>`, icons (#162) |
| `session.ts` | one hardened browser session: load, probe, CDP font pass, print |
| `probe.ts` | the in-page measurement — facts only, no policy |
| `judge.ts` | facts + definition → `Violation[]`. Pure; every rule lives here |
| `diagnostics.ts` | remedy per code, and the bounded list the model sees |
| `pdf.ts` | page count of the printed PDF, without a PDF library |
| `samples/*.html` | Candidate Sources, each aimed at something only a render can see |

## The answer

**One CDP session per document, not the REST `/pdf` call.** `htmlToPdf` today
POSTs to Browserless's `/pdf`, which returns bytes and nothing else. The render
step instead connects with `puppeteer.connect` to Browserless's WebSocket
(`puppeteer-core` is already a dependency), and in that one session it loads,
measures, and prints. One session is one metered render, so the checks add no
Browserless unit. Measured locally, probe + font pass + print take ~50ms against
~2s of load. Measured on Browserless, a 2–4 page document took 13–17s, all
inside one 30s unit (more in [What it cost](#what-it-cost)).

**The session, in order:**

1. `setJavaScriptEnabled(false)`. The probe still runs, because CDP evaluation
   is not page script. Proven by `hostile.html`: its `<script>` never runs and
   the probe does.
2. Request interception on an allowlist: `https://fonts.googleapis.com/css2` and
   `https://fonts.gstatic.com`, nothing else. Anything refused is recorded.
3. `emulateMediaType('print')` and a viewport at the definition's page size, so
   what is measured is the layout the PDF gets.
4. `setContent(…, { waitUntil: 'load' })`, **not `networkidle0`**. See
   [Found by building it](#found-by-building-it).
5. The probe (`page.evaluate`): force a layout, `await document.fonts.ready`,
   then collect page boxes, per-element line boxes, colours, effective
   backgrounds, clipping ancestors and FontFace status.
6. The font pass: `CSS.getPlatformFontsForNode` for every element that holds
   text. It reports which font actually painted which glyphs.
7. `page.pdf` at the definition's size, then count the PDF's pages.
8. Close. `judge()` runs in Node, off the browser.

**The probe measures; the judge decides.** The code that runs in the browser
holds no policy at all, and the judge is a pure function
`(definition, facts) => Violation[]`, so every rule is unit-tested against
fixtures without a browser. This is the same seam #162 chose for the static
checker.

**What it checks, and under which code.** Codes follow #162's two namespaces: a
finding a Design System key owns keeps the key path, and a finding about the
render itself is `render.*`.

| code | what it proves | remedy |
|---|---|---|
| `render.pages.geometry` | each page box is exactly `page.width`×`height` at `y = i·height` | repair |
| `render.pdf.pageCount` | the PDF has exactly as many pages as there are page elements | repair |
| `render.pages.blank` | every page shows text or an icon | repair |
| `page.safeArea` | no visible text line or painted box crosses the safe area | repair |
| `render.overflow.clipped` | no line of text is hidden by an ancestor's `overflow` | repair |
| `render.overlap` | no two elements' visible text is painted over each other | repair |
| `render.fonts.fallback` | every glyph was painted by a declared family, from the downloaded face | repair |
| `palette.pairings` | every text element's colour on its effective background is a declared pairing | repair |
| `icons.colors` | every icon's inherited `currentColor` is an allowed token | repair |
| `render.fonts.failed` | no declared face failed to load | **retry** |
| `render.timeout` | the document loaded within the budget | **retry** |
| `render.egress` | the session refused nothing | **defect** |

That covers #162's three handed-on render checks (`page.safeArea`,
`palette.pairings`, `icons.colors`), font readiness, and the research's six
deterministic defect classes (`docs/ai-document-visual-review-research.md`
§4.2). Contrast is reported as part of a `palette.pairings` finding
(`accent on accent (1.00:1)`), not as a separate rule: a declared pairing
already cleared `minContrastRatio` at seed time, so an undeclared one is the
only contrast failure possible.

**Diagnostics name the element, the page and the distance.** For example:
`[page.safeArea] page 2: p.body "Then cut the page that follows i…" crosses the
bottom safe edge by 58px`. The locator is tag, classes and a quoted text snippet.
That is what the model wrote, so it can find the element. Render findings carry
no `line`: a laid-out element has no source position. The snippet does that job.

**Only repairable findings reach the model.** Every finding has a remedy.
`repair` findings go to the model under #162's bound, unchanged: ≤3 per code
with a count of the rest, ≤40 in total, one list shared with the static checker.
A font outage or a timeout is `retry`, fixed by rendering again; a repair round
trip there spends a provider call on something the model did not do. A refused
request is `defect`: the static checker let a `url(` through, which is a bug to
alert on, never a prompt. All findings are recorded on the run regardless (#159,
#167).

## Found by building it

1. **`networkidle0` never settles on Browserless.** Fraunces 600 and 700 are one
   variable-font file. Chrome requests the URL twice and serves the second from
   memory cache, and over Browserless that intercepted duplicate never finishes.
   The first real run timed out at 20s on every document and burned the 60s
   session. It worked locally, so only the real service could show it. The fix
   is `load` + forced layout + `document.fonts.ready`. The font pass then proves
   what painted, so network idleness was never the thing that mattered.
2. **`document.fonts.check()` cannot prove font readiness.** It returns `true` for
   a family that does not exist. The research doc's §4.2 row for font fallback
   relies on it; that row is wrong. `CSS.getPlatformFontsForNode` answers the
   real question, and it answers per glyph: `glyphs.html` shows an emoji in
   Apple Color Emoji and Devanagari in Kohinoor (FreeSans on Browserless's
   Linux Chrome). §4.3 lists glyph-level fallback as something only a vision
   model could catch. It is deterministic and free.
3. **The frame needs `contain: strict`.** Without it an absolutely positioned
   element escapes its page: `top: 200px` on page 4 paints onto page 1, and
   `top: 6000px` adds PDF pages. `position: relative`, `overflow: clip` and
   `contain: paint` each leave the extra pages; only size + layout + paint
   containment stops fragmentation carrying the box to another sheet. Menu
   item 8 shows both frames side by side. **This amends #162's frame.**
4. **The frame cannot close everything; the PDF count is the net.**
   `body { height: 20000px }` prints 15 pages from 4 page elements under every
   frame variant. `body` is outside the pages, so no `.page` rule reaches it.
   The page count is the only check that sees it. Forced breaks
   (`break-before: page`) and multi-column layouts never split a page, because
   a contained, fixed-size page cannot be fragmented.
5. **Glyph boxes are not line boxes.** A Range rect is ascent + descent, which a
   tight `line-height: 1.02` makes taller than the line, so every conforming
   heading at the top of the safe area "crossed" it by 4–9px. The judge
   converts each glyph box to its line box (removing the half-leading from both
   sides), and that is what CSS lays out. What remains is Blink rounding
   ascent and descent separately (0.86px measured), hence a 1px tolerance.
   #162 predicted this failure: false positives are what hurt, because the
   model cannot fix a finding against valid CSS.
6. **Clipped text is reported once.** A line hidden by `overflow: hidden` is
   `render.overflow.clipped`, and it is excluded from the safe-area and overlap
   checks. It paints nowhere, and counting it twice produced a phantom overlap.
7. **An outage explains its own fallbacks.** With the font files refused, every
   element falls back. Those are symptoms, so when a face failed the judge
   reports `render.fonts.failed` only.
8. **The render catches what on-scale CSS hides.** `overflow.html` passes every
   #160 static check: `transform: translateX(-48px)` is open CSS, the
   `height: 128px` box is on the spacing scale. It still breaks the safe area
   and clips a quote. `colour.html` uses only valid `var(--ds-*)` tokens and
   still sets accent on accent.

## What it cost

Per 2–4 page document on Browserless (`--browserless`, three runs):

| phase | local | Browserless |
|---|---|---|
| connect + page setup | — | ~3–7s |
| load (with fonts) | ~2s cold, ms warm | 2–4s |
| probe | 5–45ms | 300–650ms |
| font pass (CDP, per text element) | 3–20ms | 2–3.6s |
| print + stream PDF back | 10–60ms | 4–7s |

Remote costs are dominated by round trips, not work. One document fits one 30s
unit. Two costs scale with page count and are worth measuring at 15 pages
before building: the font pass is one CDP call per text element, and the PDF
streams back in chunks. If a 15-page document crosses 30s, the fix is Browserless's
`/function` endpoint. It runs the same probe + font pass + print next to the
browser and returns JSON plus the PDF, with no per-call round trip. The judge
stays in Node either way.

The render timeout is also a billing guard: a hang costs units until the
session limit closes it (the `networkidle0` run cost 3 units for nothing). In
the prototype it covers only `setContent`; `fonts.ready`, the font pass and
`page.pdf` fall back to Browserless's 60s session limit. Production should put
one deadline on the whole session.

## Handed on

- **Definition resolution** — the render step takes its definition from the
  status-blind `resolve(designSystemId, designSystemVersion)` with the
  artifact's pinned pair, never `getActive` (#161). The prototype reads the
  YAML directly; `judge()` only needs a parsed definition, so nothing changes.

- **#162** — add `contain: strict` to the frame's `.page` rule. Also consider
  reserving box properties on `html`/`body` in the static grammar. The PDF
  page count catches `body { height }`, but only after a render.
- **#165** — the remedy split: only `repair` codes cost a repair attempt;
  `render.fonts.failed` and `render.timeout` are retries of the render step,
  and `render.egress` is a terminal defect. Static and render findings share
  one bounded list.
- **#167** — record every finding with its remedy per run. #159 asks for each
  check's *outcome*, not just its failures: the judge returns failures only,
  and skips silently in two places (pairings over a gradient or image
  background; fallbacks during an outage). Production should record pass/fail
  and skipped counts per check so miss rates can be measured. Watch per-document
  Browserless time at 15 pages (font pass and PDF streaming scale with it).
  Fallback fonts are platform-specific (the same Devanagari painted in Kohinoor
  locally and FreeSans on Browserless), so a fallback finding's detail
  reproduces only on the same Chrome.
- **The research doc** (`docs/ai-document-visual-review-research.md` §4.2–4.3):
  `document.fonts.check()` does not detect fallback, and glyph-level fallback
  moves from "vision only" to deterministic.
- **Implementation** — `RENDER_PDF` moves from `htmlToPdf`'s REST call to a
  `puppeteer.connect` session. Page count stops being "true by construction"
  (`carousel-renderer.service.ts`) and becomes a measured check.

## Not covered

- **Paint-order occlusion** beyond text on text: a painted box over text, or
  text over an icon. The overlap check compares text line boxes only.
- **Contrast over gradients and images.** The probe returns no background when
  a `background-image` is hit first, and the pairing is not judged.
- **Translucent colours** (`opacity`, `rgba`) are reported as "not an opaque
  palette token", not blended.
- **`maxLineLengthCh`** is measurable here (characters per line box) but stays
  guidance, per #160's ledger.
- Script execution is not a check: with JavaScript disabled nothing can run,
  and `scriptRan` is a demo sentinel set only by `hostile.html`.
- Pairings are judged for text only; a coloured box or icon over a background
  is not paired.
- A real `render.timeout` could not be produced: with scripts off and only
  Google allowed, nothing left can hang except Google. The rule is unit-tested.
- Icons are a hand-copied stub of Lucide, and assembly uses string insertion
  where production would serialise through `parse5`.
