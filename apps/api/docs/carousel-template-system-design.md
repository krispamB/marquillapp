# Carousel Template System — Design

> Status: design spec for wayfinder map #99, ticket #108 (grilling outcome).
> Author: generated for Christopher Pam. Decisions settled in a grilling session
> on 2026-07-09.
> Blocked by: #102 (artifact schema), which is closed. This ticket owns the
> `Slide` shape #102 §4 deliberately left opaque, plus how slides become a
> LinkedIn document PDF.

Feeds the final spec assembly (#110). Interlocking tickets are referenced inline
at each boundary.

## Framing (charter-derived givens)

- **A carousel is a LinkedIn *document* post.** #101's research established the
  channel: a multi-page PDF uploaded as a document (≤100 MB / ≤300 pages), shown
  as a swipeable carousel. So "carousel" = a PDF where **one page = one slide**.
- **#102 fixed the surrounding contract.** A `DOCUMENT` artifact version stores
  `content.document = { slides: Slide[]; pdfUrl?; pageCount? }` (#102 §4);
  `pdfUrl` is the R2 render output that gates `READY` (#102 §2); the R2 key is
  `artifacts/${artifactId}/${version}/document.pdf` (#102 §8); `slides` is the
  editable source of truth, `pdfUrl` the disposable derived render. #102 §4
  explicitly parked the **internal `Slide` shape** here, guessing
  `{ templateId, fields }`.
- **This slots into the engine's `RENDER_PDF` step.** #103 §2 runs `RENDER_PDF`
  for documents only; it "calls the existing Browserless→PDF path and writes the
  R2 `pdfUrl`." #108 owns what that step *renders* (templates + field schema +
  assembly); #103 owns *when* it runs.
- **The infra already exists and fits.** `htmlToPdf()`
  (`src/mark/utils/html_to_pdf.util.ts`) already defaults to **1080×1350, zero
  margin, `printBackground: true`** — the exact slide canvas. `uploadFile()`
  (`src/s3/s3.client.ts`) already puts a `Buffer` to R2 and returns a URL.
  Handlebars is already a dependency, used via a **typed template registry** +
  `.hbs` files in `assets/` (`src/mail/*`). #108 composes these, inventing no new
  infra.

The pipeline this ticket defines:

```
Slide[] (+ templateId)  →  assemble HTML (Handlebars per slide, one page each)
                        →  htmlToPdf()  →  uploadFile() → R2  →  pdfUrl
```

---

## 1. Template model — theme (deck) × slide *type* (role)

The unit a user/AI picks is a **theme** (a visual deck design). Within a theme,
each slide is rendered by a **slide-type** variant. A document has **one theme**
and an ordered list of typed slides:

```ts
type StylePreset = 'bold' | 'minimal' | 'editorial' | 'gradient';   // = theme id (§5)
type SlideType   = 'cover' | 'content' | 'list' | 'quote' | 'cta';

// document content (refines #102 §4)
{ commentary?: string;
  document: { templateId: StylePreset;   // the theme — one per deck
              slides: Slide[];           // 2–15 for launch (§3)
              pdfUrl?: string;
              pageCount?: number } }

Slide = { type: SlideType; fields: <type-specific, Zod-validated §3> };
```

**This refines #102 §4's `{ templateId, fields }` guess** deliberately:

- **Theme is document-level, not per-slide.** A carousel's whole point is a
  consistent brand look across pages; letting each slide pick a different theme
  would produce an incoherent deck. One `templateId` per document.
- **`type` is per-slide.** Real carousels are *not* homogeneous — a cover (hook),
  body slides, and a CTA/outro are visually distinct roles. So the varying axis
  *within* a deck is the slide **type**, each a variant `.hbs` under the theme.

**Rejected — per-slide `templateId` (#102's literal guess).** Maximum freedom,
but invites a Frankendeck of clashing styles and gives the AI a selection problem
it shouldn't have. Theme-once + typed-slides is the constraint that keeps output
on-brand.

**Rejected — one monolithic template per theme (no slide types).** Every slide
would share one layout; you couldn't give the cover a hero treatment or the CTA a
button. Slide types are cheap (small `.hbs` variants) and buy the visual variety
carousels need.

## 2. Template format

Each slide-type variant is a **Handlebars `.hbs` fragment** that renders exactly
one **1080×1350** slide; a theme also ships one **`theme.css`**.

- **Fixed canvas, one page per slide.** Every slide renders inside
  `<section class="slide">` sized to exactly `1080px × 1350px` with
  `page-break-after: always`. Puppeteer (via `htmlToPdf`, whose defaults already
  match — width `1080px`, height `1350px`, zero margin, `printBackground`)
  paginates **one slide per PDF page**. No per-slide `htmlToPdf` calls — the whole
  deck is one HTML document rendered once.
- **Self-contained HTML, everything inlined.** Browserless renders remote HTML
  with no reliable access to our asset host, so the assembled document inlines
  **all** CSS (base reset + `theme.css`) in a single `<head>` `<style>`, and
  embeds fonts and any decorative images as **`data:` URIs**. No external
  `<link>`/`<img src=http…>`/`@import`. This makes the render deterministic and
  fast (`waitUntil: networkidle0` resolves immediately with nothing to fetch).
- **Layered CSS.** A shared **`base.css`** (reset, the `.slide` frame box, spacing
  scale, the `page-break` rule) + a per-theme **`theme.css`** (palette,
  type scale, backgrounds). Slide-type `.hbs` files carry only structural markup
  and semantic class names the theme styles.
- **Placeholders are auto-escaped `{{field}}`.** Slide fields are LLM-generated
  (§9), so templates use **double-stache** `{{title}}` (Handlebars
  HTML-escapes by default) and **never** triple-stache `{{{…}}}`. Loops use
  `{{#each items}}`.

**Rejected — raw HTML authored by the AI (no template).** #102 §4 already ruled
this out ("structured content that fills a curated template, *not* raw HTML"). It
would be an XSS vector, produce inconsistent layouts, and make overflow
unmanageable. The AI fills **fields**, never markup.

**Rejected — a headless design lib / SVG / canvas renderer.** We already have a
working Browserless→PDF path tuned to 1080×1350; HTML/CSS is the most malleable
authoring surface and the lowest-friction path to a launch set.

## 3. Structured content schema (what the AI fills)

Each slide type has a **Zod field schema** — the contract the agent (#104) fills
and the boundary at which output is validated (repo split: Zod for LLM data). The
launch shapes, with **character caps** so text fits the fixed frame:

```ts
cover:   { eyebrow?: string(≤24); title: string(≤70); subtitle?: string(≤120) }
content: { heading: string(≤60);  body: string(≤280) }
list:    { heading: string(≤60);  items: string(≤80)[] (2–6) }
quote:   { quote: string(≤200);   attribution?: string(≤48) }
cta:     { headline: string(≤70); action: string(≤40); handle?: string(≤40) }

Slide = z.discriminatedUnion('type', [ /* one arm per SlideType */ ]);
document.slides: Slide[]  // z.array(Slide).min(2).max(15)
```

- **Caps are the fit contract.** A fixed 1080×1350 slide has no scroll — overflow
  is the enemy. Caps are chosen so worst-case text fits each theme's type scale.
  They are enforced **three ways, defence in depth:** (1) the agent prompt (#104)
  states the caps so the model aims within them; (2) Zod rejects over-cap output
  at the generation boundary; (3) `theme.css` sets `overflow: hidden` +
  `text-overflow: ellipsis` as a last-resort clamp so a slip never breaks layout.
- **A Zod failure is a terminal generation error.** Per #103 §7, Zod-invalid LLM
  output (after the agent's own internal retries) is `retryable: false` → the run
  fails cleanly rather than rendering a broken slide. In practice the prompt caps
  make this rare.
- **Slide count 2–15 for launch.** LinkedIn allows ≤300 pages (#101), but a good
  carousel is short; 2–15 bounds both UX and render time. `pageCount = slides.length`.
- **Launch is text-only.** No user-supplied slide images in v1 (keeps rendering
  deterministic — no asset fetch/upload/sizing). Visual richness comes from theme
  CSS (gradients, shapes, type). Image slides are noted future work (§10), and the
  `Slide` union is a discriminated union precisely so an `image` type can be added
  without touching existing arms.

## 4. Template selection — user-picked *or* AI-picked

Two distinct decisions, split by who's better placed to make them:

- **Theme (`templateId`) — user-picked, else AI-picked.** #102 §6's create input
  already carries `stylePreset?: StylePreset`. When the user picks a theme it is
  used verbatim. When omitted, the **agent picks** a theme from the launch set
  based on the prompt/topic (e.g. `editorial` for a thought-piece, `bold` for a
  punchy hook). The chosen `templateId` is persisted on `document` either way, so
  a refine (#103 §11) keeps the same theme unless the user changes it.
- **Slide structure (count, per-slide `type`, field values) — always AI.** The
  narrative arc — how many slides, which is a `cover` vs `list` vs `cta`, and what
  each says — is authored by the agent as it composes the deck. The user does not
  hand-assemble slides at generation time (they can manually `PATCH` afterward per
  #102 §5).

**Rejected — user hand-builds the deck slide-by-slide up front.** That's a
page-builder product, not the AI-generation flow #99 is about. Manual editing is
the post-generation `PATCH` path (#102 §5), not the create path.

**Rejected — AI free-picks any CSS/colours.** Off-brand, unbounded, and defeats
the point of a *curated* template set. The AI picks *within* the curated themes.

## 5. Launch template set

Four themes, each implementing all five slide types — small enough to hand-craft
and QA, varied enough to cover common voices:

| `templateId` | Voice | Look |
|---|---|---|
| `bold` | Punchy, hook-driven | High-contrast, oversized display type, solid accent blocks |
| `minimal` | Clean, professional | Lots of whitespace, restrained palette, thin rules |
| `editorial` | Thought-leadership | Serif headings, magazine grid, muted paper tones |
| `gradient` | Energetic, modern | Vivid gradient backgrounds, white type, rounded shapes |

- Each theme = `assets/carousel/templates/<templateId>/` containing
  `cover.hbs`, `content.hbs`, `list.hbs`, `quote.hbs`, `cta.hbs`, `theme.css`.
- `base.css` is shared across all themes.
- Adding a theme later = a new folder + one registry entry (§8); no engine change.

## 6. Rendering pipeline

A single `CarouselRenderer` owns assembly + render; the engine's `RENDER_PDF`
step calls it. Steps:

1. **Assemble HTML** — `assembleHtml(templateId, slides)`:
   - read `base.css` + `<templateId>/theme.css`, inline both into one `<style>`;
   - for each slide, `Handlebars.compile(<templateId>/<slide.type>.hbs)(slide.fields)`,
     wrapped in the `.slide` section;
   - concatenate slides in order into one `<html>` document.
2. **Render** — `htmlToPdf(html)` (existing util; defaults already 1080×1350,
   zero-margin, `printBackground`). Returns a `Buffer`. The util already throws a
   descriptive error on Browserless failure, which the `RENDER_PDF` step surfaces
   as a (retryable) `WorkflowError` (#103 §7 — Browserless timeout is transient).
3. **Store** — `uploadFile('artifacts/${artifactId}/${version}/document.pdf',
   buffer, 'application/pdf')` → returns the R2 URL.
4. **Write back** — the step writes `render = { pdfUrl, pageCount: slides.length }`
   to `RunState` (#103 §3); `PERSIST_VERSION` writes `document.pdfUrl` /
   `pageCount` onto the version, flipping it `READY` (#102 §2).

- **Handlebars is compiled per render** (matching `mail.service.ts:88`); template
  sources may be cached in-process since `.hbs` files are static assets.
- **Template registry (§8)** validates `slide.type ∈ theme's variants` and gives
  `assembleHtml` the `.hbs` path + the Zod schema; an unknown type is a terminal
  error (should never occur — the agent only emits registered types).

## 7. PDF storage in R2

- **Key:** `artifacts/${artifactId}/${version}/document.pdf` (#102 §8) — verbatim.
  **Version-scoped**, so a refine (new version, #103 §11) renders to a fresh key
  and never clobbers a prior version's PDF.
- **Overwrite-on-retry is safe.** A whole-job retry (#103 §7–8) targets the *same*
  `(artifactId, version)`, so re-rendering PUTs the same key — idempotent, no
  orphan (#103 §8's "retry overwrites rather than appends").
- **`pdfUrl` gates `READY`.** Until `uploadFile` returns and `pdfUrl` is written,
  the version stays `GENERATING` (#102 §2). List/preview surfaces use `pdfUrl` as
  the document thumbnail (#102 §8) — the rendered PDF *is* the preview; no separate
  thumbnail asset for launch.
- **Cleanup** stays a later background sweep (#102 §8 / §11), not inline — a
  soft-deleted or superseded version's PDF is reclaimed by that sweep, not by the
  renderer.

## 8. Where it lives — assets + typed registry

Mirrors the mail-template idiom (`src/mail/templates.ts` typed registry +
`assets/mail/templates/*.hbs`):

```
assets/carousel/
  base.css
  templates/
    bold/      cover.hbs content.hbs list.hbs quote.hbs cta.hbs theme.css
    minimal/   …
    editorial/ …
    gradient/  …
```

```ts
// a typed registry, keyed by StylePreset → SlideType → { hbs, fields (Zod) }
export const carouselTemplates: Record<StylePreset,
  Record<SlideType, { hbs: `${string}.hbs`; fields: z.ZodType }>> = { … };
```

- The **Zod field schemas are exported** from here and consumed by (a) #102's
  `ArtifactContent` document union (the `Slide` discriminated union), and (b)
  #104's agent generation (the shape it must fill). One source of truth for the
  slide contract.
- The `CarouselRenderer` service gets a `carousel-renderer.service.spec.ts` when
  implemented (CLAUDE.md: every service ships a spec) — assembly is pure-ish
  (string in/out) so it unit-tests without Browserless (mock `htmlToPdf` /
  `uploadFile`).

## 9. Security — LLM fields never become markup

Every slide field is **LLM-generated**, i.e. untrusted text flowing into HTML.

- **Handlebars double-stache auto-escapes** (`{{field}}`), so `<script>`/`</section>`
  in a field renders as inert text, not markup — no injection into the rendered
  page. Templates **must not** use triple-stache `{{{…}}}` for any field; that is
  a review checkpoint for every `.hbs` in the launch set.
- **Rendering is sandboxed anyway** — it runs in Browserless purely to paint a PDF;
  there are no cookies, no same-origin secrets, no navigation. Even so, escaping is
  kept as defence in depth so a malformed slide can never break out of its box or
  corrupt neighbouring slides.
- **No `data:`/remote URLs from fields.** Fields are plain text (caps in §3);
  images/fonts come only from the template's own inlined assets, never from AI
  output. (Revisit when the future `image` slide type lands — user images will
  need the existing R2 upload + validation path, not raw field URLs.)

## 10. Boundaries (owned by other tickets)

| Concern | Owner |
|---|---|
| *When* `RENDER_PDF` runs; retry/idempotency of the render step | #103 |
| The agent that fills slide fields / picks theme+types; per-slide prompts | #104 |
| `DOCUMENT` artifact/version schema, `pdfUrl` READY gate, R2 key convention | #102 |
| Credit surcharge for a Browserless render | #105 |
| `step.progress` during render (e.g. per-page) if surfaced | #107 |
| Uploading the finished PDF as a LinkedIn document on publish | #106 |
| Future: `image` slide type; per-slide PNG thumbnails; background R2 cleanup | future |

## 11. Migration note

Per the #100 clean write-over (relaunch, no users): **new surface, no migration.**
This adds `assets/carousel/**`, a `carouselTemplates` registry, and a
`CarouselRenderer` service, and it reuses the **existing** `htmlToPdf` and
`uploadFile` utilities unchanged. `src/mark/utils/html_to_pdf.util.ts` currently
lives under `src/mark`, which #103/§charter-#9 dissolves — on implementation the
util moves to a neutral home (e.g. `src/render/` or `src/s3` neighbourhood)
alongside the new renderer; its logic is untouched. No `PostDraft`-era carousel
code exists to replace.
