# Carousel Template System — Design

> Status: design spec for wayfinder map #99, ticket #108 (grilling outcome).
> Author: generated for Christopher Pam. Decisions settled in a grilling session
> on 2026-07-09; **revised 2026-07-09 (v2)** — same settled decisions, with the
> render mechanics corrected (blank trailing page, pagination invariants), the
> schema/registry split fixed (field schemas are per slide *type*, not per
> theme), and the PDF-storage contract grounded in how the app actually serves
> R2 objects (private bucket → store the key, sign on read).
> Blocked by: #102 (artifact schema), which is closed. This ticket owns the
> `Slide` shape #102 §4 deliberately left opaque, plus how slides become a
> LinkedIn document PDF.

Feeds the final spec assembly (#110). Interlocking tickets are referenced inline
at each boundary.

## Framing (charter-derived givens)

- **A carousel is a LinkedIn *document* post.** #101 §2 established the channel:
  a multi-page PDF uploaded as a document (≤100 MB, ≤300 pages, formats
  PPT/PPTX/DOC/DOCX/PDF), shown as a swipeable page-by-page card in the feed. So
  "carousel" = a PDF where **one page = one slide**. The 1080×1350 canvas is the
  4:5 portrait ratio the format is built around.
- **#102 fixed the surrounding contract.** A `DOCUMENT` artifact version stores
  `content.document = { slides: Slide[]; pdfUrl?; pageCount? }` (#102 §4); the
  render output gates `READY` (#102 §2); the R2 key is
  `artifacts/${artifactId}/${version}/document.pdf` (#102 §8); `slides` is the
  editable source of truth, the rendered PDF the disposable derived output. #102
  §4 explicitly parked the **internal `Slide` shape** here, guessing
  `{ templateId, fields }`.
- **This slots into the engine's `RENDER_PDF` step.** #103 §2 runs `RENDER_PDF`
  for documents only; it "calls the existing Browserless→PDF path and writes the
  R2 `pdfUrl`." #108 owns what that step *renders* (templates + field schema +
  assembly); #103 owns *when* it runs and its retry semantics.
- **The infra already exists and fits.** `htmlToPdf()`
  (`src/mark/utils/html_to_pdf.util.ts`) defaults to **width `1080px`, height
  `1350px`, zero margins, `printBackground: true`**, and sets the Browserless
  viewport to the same dimensions — the exact slide canvas. `uploadFile(key,
  buffer, mimeType)` (`src/s3/s3.client.ts`) PUTs to R2; `getSignedUrl(key)` and
  `getFile(key)` already exist for reads. Handlebars is already a dependency,
  used via a **typed template registry** + `.hbs` files in `assets/`
  (`src/mail/templates.ts` + `assets/mail/templates/`). #108 composes these,
  inventing no new infra.

The pipeline this ticket defines:

```
Slide[] (+ templateId)  →  assemble HTML (Handlebars per slide, one page each)
                        →  htmlToPdf()  →  uploadFile() → R2 key  →  signed URL on read
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
              pdfKey?: string;           // R2 key of the render (§7; #102 §4's `pdfUrl`, renamed)
              pageCount?: number } }

Slide = { type: SlideType; fields: <type-specific, Zod-validated §3> };
```

**This refines #102 §4's `{ templateId, fields }` guess** deliberately:

- **Theme is document-level, not per-slide.** A carousel's whole point is a
  consistent brand look across pages; letting each slide pick a different theme
  would produce an incoherent deck. One `templateId` per document.
- **`type` is per-slide.** Real carousels are *not* homogeneous — a cover
  (hook), body slides, and a CTA/outro are visually distinct roles. So the
  varying axis *within* a deck is the slide **type**, each a variant `.hbs`
  under the theme.
- **Field schemas attach to the slide type, not the theme** (§3). Every theme
  renders the same five typed shapes; themes differ only in how those shapes
  look. This is what lets one Zod contract serve #102's content union, #104's
  generation, and all four launch themes simultaneously.

**Rejected — per-slide `templateId` (#102's literal guess).** Maximum freedom,
but invites a Frankendeck of clashing styles and gives the AI a selection
problem it shouldn't have. Theme-once + typed-slides is the constraint that
keeps output on-brand.

**Rejected — one monolithic template per theme (no slide types).** Every slide
would share one layout; you couldn't give the cover a hero treatment or the CTA
a button. Slide types are cheap (small `.hbs` variants) and buy the visual
variety carousels need.

## 2. Template format

Each slide-type variant is a **Handlebars `.hbs` fragment** that renders exactly
one **1080×1350** slide; a theme also ships one **`theme.css`**.

### Pagination — the one-slide-one-page invariant

The whole deck is **one HTML document rendered in one `htmlToPdf` call** (no
per-slide render round-trips). Puppeteer paginates it into PDF pages; the CSS
must make that pagination exact:

```css
/* base.css — the frame every theme inherits */
html, body { margin: 0; padding: 0; }
body       { print-color-adjust: exact; -webkit-print-color-adjust: exact; }

.slide {
  box-sizing: border-box;        /* theme padding never inflates the box */
  width: 1080px;
  height: 1350px;
  overflow: hidden;              /* nothing ever spills onto the next page */
  overflow-wrap: anywhere;       /* one long token can't blow the box sideways */
  break-after: page;             /* one slide per PDF page */
  break-inside: avoid;
}
.slide:last-child { break-after: auto; }   /* no blank trailing page */
```

- **`break-after: page` on every slide *except the last*.** A break after the
  final slide emits an empty 1080×1350 page, which LinkedIn would show as a
  blank last card — the `:last-child` override is load-bearing, not cosmetic.
- **The page box matches the slide box exactly.** `htmlToPdf` passes
  `width: '1080px', height: '1350px'`, zero margins (Chromium resolves px at 96
  CSS px/in → an 11.25 in × 14.0625 in page), and a matching viewport. With
  `box-sizing: border-box`, zeroed body margins, and `overflow: hidden` on the
  slide, no rounding slack or oversized content can push a fragment onto an
  extra page. No `@page` rules or `preferCSSPageSize` needed — the explicit
  options are the single source of page geometry.
- Slides are `<section class="slide slide--{{type}}">…</section>`, concatenated
  in `slides[]` order.

### Self-contained HTML — everything inlined

Browserless renders the POSTed HTML string with no reliable access to our asset
host, so the assembled document must resolve **zero network requests**:

- All CSS (base + `theme.css`) is inlined in a single `<head>` `<style>`.
- **Fonts:** themes use **system font stacks by default** (e.g. a Georgia stack
  for `editorial`'s serif) — zero payload, zero load risk. A theme that needs a
  brand font embeds it as a **subset WOFF2 `data:` URI** in its `theme.css`
  (~30 KB per weight; keep the assembled HTML payload well under ~2 MB since it
  travels in the Browserless POST body).
- Decorative imagery is CSS (gradients, shapes) or small inline SVG / `data:`
  URIs. No external `<link>`, `<img src="http…">`, or `@import`.
- With nothing to fetch, `waitUntil: 'networkidle0'` (the util's setting)
  resolves immediately — renders are deterministic and fast.
- **Emoji:** LLM copy may contain emoji; whether they render depends on the
  Browserless image shipping a color-emoji font (Noto Color Emoji is standard
  but unverified). The fixture deck (§3) includes an emoji sample; if it renders
  as tofu, the generation prompt (#104) bans emoji rather than us embedding a
  multi-megabyte emoji font.

### Layered CSS, structural markup

A shared **`base.css`** (reset, the `.slide` frame above, spacing scale) + a
per-theme **`theme.css`** (palette, type scale, backgrounds, per-type layout).
Slide-type `.hbs` files carry only structural markup and semantic class names
the theme styles.

### Placeholders

Slide fields are LLM-generated (§9), so templates use **auto-escaping
double-stache `{{field}}` only, and only in element text content** — never in
attributes, URLs, `<style>`, or comments, where HTML-escaping is not a
sufficient defence. Lists use `{{#each items}}`. Triple-stache `{{{…}}}` is
banned and enforced at boot (§6). Multi-line fields (`content.body`,
`quote.quote`) render inside an element styled `white-space: pre-line` so
intentional line breaks survive; all other fields are single-line.

**Rejected — raw HTML authored by the AI (no template).** #102 §4 already ruled
this out ("structured content that fills a curated template, *not* raw HTML").
It would be an XSS vector, produce inconsistent layouts, and make overflow
unmanageable. The AI fills **fields**, never markup.

**Rejected — a headless design lib / SVG / canvas renderer.** We already have a
working Browserless→PDF path tuned to 1080×1350; HTML/CSS is the most malleable
authoring surface and the lowest-friction path to a launch set.

## 3. Structured content schema (what the AI fills)

Each slide **type** has one **Zod field schema** — shared by all themes — that
is the contract the agent (#104) fills and the boundary at which output is
validated (repo split: Zod for LLM data):

```ts
const cap = (n: number) => z.string().trim().min(1).max(n);

export const slideFieldSchemas = {
  cover:   z.object({ eyebrow: cap(24).optional(), title: cap(70), subtitle: cap(120).optional() }),
  content: z.object({ heading: cap(60), body: cap(280) }),
  list:    z.object({ heading: cap(60), items: z.array(cap(80)).min(2).max(6) }),
  quote:   z.object({ quote: cap(200), attribution: cap(48).optional() }),
  cta:     z.object({ headline: cap(70), action: cap(40), handle: cap(40).optional() }),
} as const;

export const slideSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('cover'),   fields: slideFieldSchemas.cover }),
  z.object({ type: z.literal('content'), fields: slideFieldSchemas.content }),
  z.object({ type: z.literal('list'),    fields: slideFieldSchemas.list }),
  z.object({ type: z.literal('quote'),   fields: slideFieldSchemas.quote }),
  z.object({ type: z.literal('cta'),     fields: slideFieldSchemas.cta }),
]);

// document.slides — plugs into #102 §4's DOCUMENT content schema
export const slidesSchema = z.array(slideSchema).min(2).max(15);
```

- **Caps are the fit contract — sized to the tightest theme.** A fixed
  1080×1350 slide has no scroll; overflow is the enemy. Character count is a
  *proxy* for rendered width (70 "W"s are wider than 70 "i"s), so the caps are
  calibrated against the theme with the largest type scale, and enforced
  **three ways, defence in depth:** (1) the agent prompt (#104) states the caps
  so the model aims within them; (2) Zod rejects over-cap output at the
  generation boundary; (3) the `.slide` frame's `overflow: hidden` +
  `overflow-wrap: anywhere` (§2) is the last-resort clamp so a slip degrades to
  clipped text, never a broken layout or a spilled page.
- **The fixture deck is the fit proof.** Each theme ships a fixture: a
  15-slide deck exercising every slide type at **maximum** field lengths
  (6-item list, full-cap strings, an emoji, a long unbroken token). A registry
  spec test asserts it assembles and renders cleanly through the template
  layer; rendering the fixtures to PDF is the manual QA gate for each theme
  before launch (and would surface any pagination regression as a page-count
  mismatch or blank page). Caps are only trustworthy because the fixtures
  prove them.
- **A Zod failure is a terminal generation error.** #104 §8 gives `generate()`
  one inline repair retry (re-prompt with the validation error); if the output
  is still invalid the run fails per #103 §7 rather than rendering a broken
  deck. In practice the prompt caps make this rare.
- **Slide count 2–15 for launch.** LinkedIn allows ≤300 pages (#101), but a
  good carousel is short; 2–15 bounds UX, render time, and worst-case LLM
  output size. `pageCount = slides.length` — true by construction of the §2
  pagination invariant, which the fixture decks guard.
- **Launch is text-only.** No user-supplied slide images in v1 (keeps rendering
  deterministic — no asset fetch/upload/sizing). Visual richness comes from
  theme CSS. `slideSchema` is a discriminated union precisely so a future
  `image` slide type is a new arm, touching no existing one (§10).

**Rejected — per-theme field schemas** (caps varying with each theme's type
scale). Tighter per-theme fit, but the schema is shared with #102's content
union and #104's generation contract, neither of which can vary by theme — a
per-theme schema would fork the single source of truth. One schema, calibrated
to the tightest theme, keeps the contract whole at the cost of slightly
conservative caps in roomier themes.

## 4. Template selection — user-picked *or* AI-picked

Two distinct decisions, split by who's better placed to make them:

- **Theme (`templateId`) — user-picked, else AI-picked.** #102 §6's create
  input already carries `stylePreset?: StylePreset`.
  - **User supplied it** → it is authoritative: the `GENERATE` step **stamps**
    `document.templateId = stylePreset` after generation; the model is not
    asked to choose and its output cannot override the user.
  - **Omitted** → the generation prompt (#104) asks the model to pick a
    `templateId` from the `StylePreset` enum based on the prompt/topic (e.g.
    `editorial` for a thought-piece, `bold` for a punchy hook); the Zod
    boundary validates it is a real preset.
  - Either way the chosen `templateId` is persisted on `document`, so a refine
    (#103 §11) keeps the same theme unless the user changes it.
- **Slide structure (count, per-slide `type`, field values) — always AI.** The
  narrative arc — how many slides, which is a `cover` vs `list` vs `cta`, and
  what each says — is authored by the agent as it composes the deck. The user
  does not hand-assemble slides at generation time (they can manually `PATCH`
  afterward per #102 §5; a slide edit re-renders the PDF per #102 §4).

**Rejected — user hand-builds the deck slide-by-slide up front.** That's a
page-builder product, not the AI-generation flow #99 is about. Manual editing
is the post-generation `PATCH` path (#102 §5), not the create path.

**Rejected — AI free-picks any CSS/colours.** Off-brand, unbounded, and defeats
the point of a *curated* template set. The AI picks *within* the curated
themes.

## 5. Launch template set

Four themes, each implementing all five slide types — small enough to
hand-craft and QA (4 × 5 = 20 `.hbs` fragments + 4 stylesheets + 4 fixture
decks), varied enough to cover common voices:

| `templateId` | Voice | Look |
|---|---|---|
| `bold` | Punchy, hook-driven | High-contrast, oversized display type, solid accent blocks |
| `minimal` | Clean, professional | Lots of whitespace, restrained palette, thin rules |
| `editorial` | Thought-leadership | Serif headings (system Georgia stack), magazine grid, muted paper tones |
| `gradient` | Energetic, modern | Vivid gradient backgrounds, white type, rounded shapes |

- Each theme = `assets/carousel/templates/<templateId>/` containing
  `cover.hbs`, `content.hbs`, `list.hbs`, `quote.hbs`, `cta.hbs`, `theme.css`,
  `fixture.json` (§3).
- `base.css` is shared across all themes.
- Adding a theme later = a new folder + one registry entry (§8); no schema or
  engine change (schemas are per-type, §3).

## 6. Rendering pipeline

A single `CarouselRenderer` owns assembly + render; the engine's `RENDER_PDF`
step calls it.

**At module init (boot), not per render:** the registry (§8) loads and
`Handlebars.compile`s every `(theme, slide type)` template once, and **fails
fast** if any file is missing, fails to compile, or contains `{{{` — turning
the no-triple-stache rule (§9) from a review checkpoint into an enforced
invariant. Templates are static assets, so boot-time compilation is safe and
makes per-render work pure string interpolation. (The mail service compiles
per-send — `mail.service.ts:88` — which is fine at mail volume; a deck
interpolates up to 15 fragments per render, so precompiling is the same idiom
moved to init.)

**Per render**, the `RENDER_PDF` step:

1. **Assemble** — `assembleHtml(templateId, slides): string` (pure, no I/O at
   render time): for each slide, apply the precompiled
   `<templateId>/<slide.type>` template to `slide.fields`, wrap in the
   `.slide` section, concatenate in order inside one `<html>` document whose
   `<head>` inlines `base.css` + the theme's `theme.css`.
2. **Render** — `htmlToPdf(html)` (existing util, defaults untouched) →
   `Buffer`. The util already throws a descriptive error on Browserless
   failure; the step surfaces it as a **retryable** `WorkflowError` (#103 §7 —
   Browserless timeouts are transient).
3. **Store** — `uploadFile('artifacts/${artifactId}/${version}/document.pdf',
   buffer, 'application/pdf')` (§7).
4. **Write back** — the step returns
   `render = { pdfKey, pageCount: slides.length }` into `RunState` (#103 §3);
   `PERSIST_VERSION` writes both onto the version, flipping it `READY`
   (#102 §2).

An unknown `slide.type` or `templateId` at assembly is a **terminal** error
(should never occur — Zod validated the content at generation), not a retry:
re-running cannot fix invalid input.

## 7. PDF storage in R2 — store the key, sign on read

- **Key:** `artifacts/${artifactId}/${version}/document.pdf` (#102 §8) —
  verbatim. **Version-scoped**, so a refine (new version, #103 §11) renders to
  a fresh key and never clobbers a prior version's PDF.
- **Persist the key (`pdfKey`), not a raw URL.** `uploadFile` returns a
  `…r2.cloudflarestorage.com` URL, but the bucket is **private** — nothing in
  the app serves that URL to clients today; the existing media flow stores an
  `r2Key` and reads server-side via `getFile`. So the version stores the
  **key**, and:
  - **Client reads** (#102's GET/list, where the render is the document's
    preview/thumbnail) exchange it for a short-lived **signed URL** via the
    existing `getSignedUrl(key)` at response time.
  - **Publish** (#106) fetches the buffer server-side via `getFile(key)` to
    upload to LinkedIn — which needs the key anyway, and is exactly how
    `linkedin-media.service.ts` already handles media.
  - *Interlock note for #110:* this renames #102 §4's `pdfUrl?` field to
    `pdfKey?` — same slot, same READY-gating semantics, corrected to what a
    private bucket can actually serve. (The key is also derivable from
    `(artifactId, version)`; storing it keeps reads convention-free.)
- **Overwrite-on-retry is safe.** A whole-job retry (#103 §7–8) targets the
  *same* `(artifactId, version)`, so re-rendering PUTs the same key —
  idempotent, no orphans (#103 §8's "retry overwrites rather than appends").
- **`pdfKey` gates `READY`.** Until the upload returns and `pdfKey` is
  written, the version stays `GENERATING` (#102 §2). The rendered PDF *is* the
  preview; no separate thumbnail asset for launch.
- **Cleanup** stays a later background sweep (#102 §8/§11), not inline — a
  soft-deleted or superseded version's PDF is reclaimed by that sweep, not by
  the renderer.

## 8. Where it lives — assets + typed registry

Mirrors the mail-template idiom (`src/mail/templates.ts` typed registry +
`assets/mail/templates/*.hbs`), as a new **`src/carousel/`** feature module:

```
assets/carousel/
  base.css
  templates/
    bold/       cover.hbs content.hbs list.hbs quote.hbs cta.hbs theme.css fixture.json
    minimal/    …
    editorial/  …
    gradient/   …

src/carousel/
  carousel.module.ts
  carousel-renderer.service.ts       # assembleHtml + render + store (§6)
  carousel-renderer.service.spec.ts  # CLAUDE.md: every service ships a spec
  templates.ts                       # registry (below) + boot-time compile/validation
  schemas.ts                         # slideFieldSchemas / slideSchema / slidesSchema (§3)
  utils/html-to-pdf.util.ts          # moved from src/mark (§11), renamed to kebab-case
```

```ts
// schemas are per slide type (§3) — the registry maps theme × type to markup only
export const carouselTemplates: Record<
  StylePreset,
  Record<SlideType, { hbs: `${string}.hbs` }>
> = { … };
```

- **The Zod schemas in `schemas.ts` are the single source of truth** for the
  slide contract, consumed by (a) #102's `ArtifactContent` document union and
  (b) #104's `generate()` output validation. The registry deliberately does
  **not** carry schemas — keying them by theme (v1 of this doc did) would
  invite per-theme divergence of a contract that must stay uniform (§3).
- Assembly is pure string-in/string-out, so `carousel-renderer.service.spec.ts`
  unit-tests it without Browserless (mock `htmlToPdf` / `uploadFile`); the
  registry spec iterates every theme's fixture deck through `assembleHtml`
  (§3).

## 9. Security — LLM fields never become markup

Every slide field is **LLM-generated**, i.e. untrusted text flowing into HTML.

- **Handlebars double-stache auto-escapes** (`{{field}}`), so `<script>` /
  `</section>` in a field renders as inert text — a field can't inject markup
  or break out of its slide box.
- **Interpolation is restricted to element text content** (§2). Escaping is
  only a complete defence in that context — fields never appear in attribute,
  URL, or style position, so there is no context where escaped-but-dangerous
  values (e.g. `javascript:` URLs) could matter.
- **Triple-stache is banned and machine-enforced** — registry boot fails on any
  template source containing `{{{` (§6), so the rule can't erode as templates
  are added. No custom Handlebars helpers that emit `SafeString`s either;
  built-in `{{#each}}`/`{{#if}}` only.
- **Rendering is sandboxed anyway** — Browserless paints a PDF from an inert
  document; there are no cookies, no same-origin secrets, no navigation.
  Escaping is kept as defence in depth, not the only wall.
- **No `data:`/remote URLs from fields.** Fields are plain text (§3);
  fonts/decoration come only from the template's own inlined assets, never
  from AI output. (Revisit when the future `image` slide type lands — user
  images go through the existing R2 upload + validation path, not raw field
  URLs.)

## 10. Boundaries (owned by other tickets)

| Concern | Owner |
|---|---|
| *When* `RENDER_PDF` runs; retry/idempotency of the render step | #103 |
| The agent that fills slide fields / picks theme+types; prompt wording (caps, emoji policy, theme-choice guidance) | #104 |
| `DOCUMENT` artifact/version schema, READY gate, R2 key convention (with the §7 `pdfKey` rename) | #102 |
| Signed-URL exchange on GET/list responses | #102 |
| Credit surcharge for a Browserless render | #105 |
| `step.progress` during render, if surfaced | #107 |
| Fetching the PDF and uploading it as a LinkedIn document on publish | #106 |
| Future: `image` slide type; per-slide PNG thumbnails; background R2 cleanup; re-render on manual slide `PATCH` mechanics | future |

## 11. Migration note

Per the #100 clean write-over (relaunch, no users): **new surface, no
migration.** This adds `assets/carousel/**` and the `src/carousel/` module
(§8), and reuses the existing `htmlToPdf` and `uploadFile`/`getSignedUrl`/
`getFile` utilities with their logic untouched. `src/mark/utils/
html_to_pdf.util.ts` currently lives under `src/mark`, which #103/charter #9
dissolves — on implementation the util moves to `src/carousel/utils/` and is
renamed **`html-to-pdf.util.ts`** (the current snake_case name violates the
repo's kebab-case file convention). No `PostDraft`-era carousel code exists to
replace.
