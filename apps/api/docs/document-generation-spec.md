# Document Generation with Design Systems — Specification

> Status: **build-ready specification.** Assembled for wayfinder map
> [#131](https://github.com/krispamB/marquillapp/issues/131), ticket
> [#142](https://github.com/krispamB/marquillapp/issues/142), from the closed tickets #132–#141.
> Compiled 2026-10-01.
>
> This document is the destination of map #131 and the **normative contract for generating,
> validating, rendering, storing and refining DOCUMENT artifacts**. Where it conflicts with an
> older design document, this document wins; §0 lists exactly which older sections it replaces.
> Each section cites the ticket that decided it. Where a later ticket amended an earlier one, only
> the final rule is stated here, and the citation names both.

## Contents

0. [Status and how to read this](#0-status-and-how-to-read-this)
1. [What changes](#1-what-changes)
2. [Domain terms](#2-domain-terms)
3. [Design Systems](#3-design-systems)
4. [Candidate Source and Document Source](#4-candidate-source-and-document-source)
5. [Rendering and render validation](#5-rendering-and-render-validation)
6. [Artifact versions](#6-artifact-versions)
7. [Generation workflow](#7-generation-workflow)
8. [Visual review](#8-visual-review)
9. [Client API changes](#9-client-api-changes)
10. [Configuration and constants](#10-configuration-and-constants)
11. [Tests, eval, observability and rollout](#11-tests-eval-observability-and-rollout)
12. [Removal plan](#12-removal-plan)
13. [Build order](#13-build-order)

---

## 0. Status and how to read this

**Scope.** Everything about the DOCUMENT artifact type: how its look is constrained, what the model
writes, how that is checked, assembled and rendered, how versions are stored, refined and pinned by
Posts, and how the feature is tested and operated. POST and POLL are affected only where a rule is
stated for every artifact type (§6.1, §6.2, §7.8).

**Superseded and amended documents.** These carry a dated notice pointing here. Their bodies are
kept as history and are not edited, with one exception: the body of PRD §8 is replaced by a pointer,
because it is the only copy of the template design inside a document that calls itself build-ready.

| Document | Status | Sections replaced |
|---|---|---|
| `carousel-template-system-design.md` | **Superseded** | all |
| `artifact-workflow-prd.md` | Amended | §2 (R4 themes), §4 (document content, `currentVersion`), §6, §8 (body replaced), §9 (render billing), §11 (`pageRendered`), §13, §15 |
| `artifact-schema-and-library-api-design.md` | Amended | §1, §2, §4, §5, §8 |
| `artifact-workflow-step-pipelines-design.md` | Amended | DOCUMENT pipelines, `GENERATE`, `RENDER_PDF`, `PERSIST_VERSION`, §8 |
| `workflow-engine-design.md` | Amended | §4, §7 |
| `sse-progress-contract-design.md` | Amended | §3 |
| `post-schema-and-publish-flow-design.md` | Amended | §4 |
| `agent-loop-and-research-agent-design.md` | Amended | §4, §8 |
| `credit-usage-system-design.md` | Amended | the `pdf_render` surcharge |

**Not changed now.** `docs/api/*` describes what the server does today and is the client's source of
truth. It changes in the build, endpoint by endpoint, in the same commit as the code and the web
caller (§9). The same holds for the deploy rule bound for `docs/monorepo.md` (§11.7).

**Prototypes.** Three prototypes on `main` are reference implementations, cited by path. Each is
deleted when its production equivalent lands (§12).

| Prototype | Ticket | Path |
|---|---|---|
| Design System Definition contract, prompt fragment, static checker | #134, #136 | deleted; production in `src/design-system/` and `src/document-source/` (#158, #160) |
| Render session, probe, judge, assembly | #137 | `src/carousel/prototype-render-validation/` |
| Six default systems, previews | #140 | `src/carousel/prototype-design-systems/` |

## 1. What changes

Fixed carousel templates (four Handlebars themes filled with structured slide fields) are replaced
by **AI-authored HTML and CSS**, constrained by an **app-owned, versioned Design System**. The model
writes the whole document; the app checks it against an allowlist grammar and the Design System,
renders it in Browserless while measuring it, sends bounded findings back for Repair, and stores the
accepted source and its PDF as an immutable Document Version.

Settled boundaries (map #131):

- Design Systems are app-owned. Repository YAML seeds versioned MongoDB records.
- Generated HTML and CSS are internal and untrusted. Clients never read or submit them.
- Fonts are allowlisted Google Fonts loaded by Browserless. Icons come from an app-owned, inlined
  catalog.
- A Refinement creates a new immutable version; the prior `READY` version stays current until its
  replacement is `READY`.
- Provider usage from generation, Repair and rendering is metered through the existing credit path.

Out of scope: frontend implementation (including a Design System picker and an HTML editor), an
admin authoring API, user- or organisation-owned Design Systems, image assets of any kind, direct
client access to Document Source, and compatibility with template-based Document Versions.

## 2. Domain terms

`apps/api/CONTEXT.md` is the glossary and is not repeated here. The terms this specification depends
on: **Design System**, **App-Owned Design System**, **Design System Definition**, **Design System
Version**, **Candidate Source**, **Document Source**, **Document Version**, **Attempt**, **Current
Version**, **Refinement**, **Repair**. Respect their _Avoid_ lists in code and docs: there is no
"template", "theme", "draft version", "head", or "fix" in this feature's vocabulary.

## 3. Design Systems

### 3.1 The Definition contract (#134, amended by #136 and #137)

A Design System Definition is one contract-versioned YAML file, parsed once by Zod. One parsed object
feeds both consumers: `renderPromptFragment(definition)` produces the text the model reads, and the
checkers (§4, §5) produce violations against a Candidate Source. Nothing is restated in a prompt
constant.

Top-level keys: `contract`, `id`, `version`, `name`, `summary`, `intent`, `page`, `palette`,
`typography`, `spacing`, `icons`, `composition`. Reference: `src/design-system/design-system-definition.ts`
and the six seeds in `assets/design-systems/`.

Every key belongs to exactly one consumer class:

| Class | Keys |
|---|---|
| **Static check** (§4) | `page.pages`, `page.background`, `palette.tokens`, `palette.rules.externalColors`, `palette.rules.references`, `typography.fonts`, `typography.scale`, `typography.rules.minPx`, `typography.rules.transforms`, `spacing.scale`, `icons.allowed`, `icons.sizes`, `icons.rules.maxPerPage`, `composition.pageRoles` |
| **Render check** (§5) | `page.safeArea`, `palette.pairings` actually used, `icons.colors` |
| **Seed check** (§3.3) | identity, `palette.rules.minContrastRatio`, `spacing.base`, `typography.rules.minPx`, safe area expressible in the spacing scale |
| **Guidance only** | `intent`, `composition.principles`, `composition.antiPatterns`, `icons.rules.role`, `typography.rules.maxLineLengthCh`, per-step `use` lines |

`page.width` and `page.height` are not checked: the backend writes them into the frame (§4.3), so
they are true by construction.

Rules:

1. **Exact sets, not ranges.** The type scale and spacing scale are enumerated; a value outside the
   set is a violation.
2. **Strict palette references.** Hex literals appear only in `:root` as `--ds-<token>`; every use is
   `var(--ds-<token>)`. A bare hex outside `:root` is a violation even when it matches a token.
3. **Labelled page roles.** Every page carries `data-role="<role>"`. Role names, `first`/`last` pins
   and `required` are checked; per-role `guidance` is advisory.
4. **All guidance keys stay.** The standing prompt cost is ~850–1,140 tokens per system (#140).
5. **Cross-references are validated at parse**, not at generation: 13 distinct errors (unknown token,
   unshipped weight, scale step below the floor, two roles pinned `first`, …) fail before a token is
   spent.
6. **`icons.allowed` is `min(1)`.** Every launch system allows 1–4 icons (#140).

### 3.2 Storage and identity (#135)

The slug is the identity; ObjectIds are never exposed. One immutable document per `(id, version)` in
`design_systems`:

```ts
{
  id: 'margin',             // slug, from YAML
  version: 1,               // author-chosen snapshot number
  contract: 1,              // shape version it parsed against
  name, summary,            // denormalised for list reads
  definition: { ... },      // the Zod-parsed object, stored whole (@Prop({ type: Object }))
  checksum: 'sha256:...',   // over the canonical YAML bytes
  status: 'ACTIVE' | 'SUPERSEDED' | 'RETIRED',
  seededAt: Date,
}
```

- Unique index on `(id, version)`; non-unique on `id`; **partial unique index on `{ id }` where
  `status: 'ACTIVE'`**.
- `definition`, `contract`, `version` and `checksum` are immutable after insert. `status` is the
  only mutable field.
- **Status governs selection, never resolution.** `SUPERSEDED` and `RETIRED` versions are never
  deleted and resolve forever on an exact `(id, version)` read.

### 3.3 Seeding (#135, #136, #140)

`bun run seed:design-systems` is the only writer. Seed directory: `assets/design-systems/<id>/` with
`definition.ds.yaml`, `sample.html`, and `previews/page-NN.png`.

Per file: parse; look up `(id, version)`.

| Found | Action |
|---|---|
| absent, `version > max(stored)` | insert `ACTIVE`, flip the prior `ACTIVE` to `SUPERSEDED`, one transaction |
| present, checksum matches | no-op |
| present, checksum differs | **fatal**, report path and both checksums |
| absent, `version ≤ max(stored)` | **fatal** |

- **Any failure aborts the whole run, writing nothing.** That covers parse errors, a `contract ≠
  SUPPORTED_CONTRACT`, a Google family outside `DESIGN_SYSTEM_FONT_ALLOWLIST`, an `icons.allowed`
  name absent from the pinned icon catalog, a system with no preview images, and a
  `DEFAULT_DESIGN_SYSTEM_ID` that does not name an `ACTIVE`, listed system.
- **Declarative retirement.** Any id with an `ACTIVE` version and no directory is flipped to
  `RETIRED`. Deleting the directory is how a system stops being offered.
- Versions are hand-authored, strictly increasing per id, gaps allowed.
- YAML parsing uses the `yaml` package (new dependency). Font fallback lists must be quoted.

**Boot verifies, never writes.** `DesignSystemsService.onModuleInit` loads the `ACTIVE` set and fails
the boot if any seed file's checksum is absent from the database.

**Contract versions.** `SUPPORTED_CONTRACT = 1`. Exactly one contract is consumable. A bump is a
seeding event (every YAML edited and seeded as a new `version`), never an in-place migration of
stored definitions; older-contract documents are retained for provenance and are not consumable by
generation (§7.4).

### 3.4 Reads and selection (#135, #138, #141, #142)

```ts
listActive(): DesignSystemSummary[]       // ACTIVE minus UNLISTED_DESIGN_SYSTEMS
getActive(id): DesignSystemRecord         // throws unless ACTIVE and listed
resolve(id, version): DesignSystemRecord  // status-blind; for pinned reads
```

- `resolve` is what generation, Repair, render checks and refine call with a version's pin. It
  ignores status and `UNLISTED_DESIGN_SYSTEMS`, so existing pins always resolve.
- Cache: in-process, keyed by `(id, version)`, never invalidated. **A seed run needs a restart to
  reach a running process.**
- The prompt fragment is neither stored nor a service method: it is the pure
  `renderPromptFragment(definition)`, memoised per `(id, version)`.
- **The client sends a slug or nothing, never a version.** The server resolves the `ACTIVE` version
  and stamps the pin (§6.3). An unknown, superseded, retired or unlisted slug is a `400` in the
  request path.
- **Omitted means `DEFAULT_DESIGN_SYSTEM_ID = 'margin'`** (#142). The model never chooses. The
  rollout cannot proceed while the default is unlisted (§11.7).
- Not tier-gated at launch.

### 3.5 Client routes (#135, #142)

```
GET /design-systems
  -> 200 [{ id, version, name, summary, previews: string[] }]

GET /design-systems/:id/:version/previews/:n.png
  -> 200 image/png, Cache-Control: public, max-age=31536000, immutable
```

- Both routes sit behind the artifact routes' auth guard. The list returns `ACTIVE`, listed systems
  only. There is no detail endpoint.
- `previews` are API paths in page order. The preview route serves the file from
  `assets/design-systems/<id>/previews/` (the image already ships `assets/`). It returns `404` unless
  `(id, version)` is the `ACTIVE` version, because only the active version's images exist in the repo.
  The version in the path changes the URL whenever the images change.

### 3.6 Launch set (#140)

Six systems, seeded at `assets/design-systems/<id>/` (commit `5aa3472`):

| id | Look |
|---|---|
| `margin` (**default**) | Quiet minimalism: one family, no accent, mostly empty page |
| `broadside` | Swiss poster: condensed capitals, cobalt slab, red rules |
| `colophon` | Magazine feature: Didone serif, cropped oxblood numeral |
| `afterglow` | Night mode: violet-to-tangerine glow on near-black, glass panels |
| `overprint` | Risograph zine: overlapping fluoro shapes, blue ink |
| `schematic` | Blueprint: drafting grid, mono annotations, title block |

`DESIGN_SYSTEM_FONT_ALLOWLIST` (twelve families): Anton, Archivo, Bodoni Moda, Oswald, Inter, Inter
Tight, Sora, Manrope, Bricolage Grotesque, Space Mono, Space Grotesk, JetBrains Mono. It is a module
constant read by both the seed check and assembly (§4.5). Adding a font is a deploy.

Each directory's `sample.html` is a conforming Candidate Source; the previews are that sample
rendered at 540×675. A definition change means a new `version`, a re-checked sample and re-rendered
previews.

## 4. Candidate Source and Document Source

### 4.1 Lifecycle (#136)

```
model emits -> CANDIDATE SOURCE -> static check (pure) -> assemble -> DOCUMENT SOURCE -> render + judge
                                        |                                                  |
                                        +----------- violations -> Repair (§7.2) <---------+
```

The checker validates Candidate Source only. Assembly then adds what was never the model's to choose.
A Document Source is frozen with its version and never re-validated; it deliberately no longer
satisfies the grammar (two `<style>` blocks, populated `<svg>`).

### 4.2 Grammar (#136)

A complete HTML document, checked as a structural allowlist, not a byte-exact preamble:

- **`<head>`:** `<meta charset="utf-8">`, optional `<title>`, exactly one `<style>`. No `<link>`.
- **`<body>`:** only `<section class="page" data-role="…">` elements. No nested `<section>`.
- **Inside a page:** `div`, `header`, `footer`, `figure`, `figcaption`, `blockquote`, `ul`, `ol`,
  `li`, `h1`–`h6`, `p`, `span`, `strong`, `em`, `small`, `q`, `cite`, `sup`, `sub`, `br`, `hr`,
  `svg`.
- **Attributes:** `class`; `data-role` on page elements only; `data-icon` and `data-size` on `svg`
  only. Nothing else, so no `id`, no inline `style=`, no `on*`, no `href`.
- Comments are permitted and ignored. Text is UTF-8.

Prohibited by omission, among others: `script`, `iframe`, `img`, `object`, `embed`, `video`, `audio`,
`link`, `form`, `input`, `button`, `canvas`, `template`, `noscript`, `base`, `a`, `table`.

**CSS prohibitions.** The envelope is Design-System-agnostic: it protects the render, and taste
belongs to the definition. Everything not listed is open (`transform`, `filter`, `clip-path`, grid,
blend modes, gradients, `color-mix`, `backdrop-filter`).

| Prohibited | Why |
|---|---|
| any `url(` token (including `data:`) | the network boundary; a fetch is a hang and a metered cost |
| `@import`, `image-set()` | the same boundary |
| `@font-face` | families come only from the definition and the allowlist |
| `@media`, `@supports`, `@container` | one device, one render; conditional CSS makes every value check conditional |
| `@page` | fights the injected frame |
| `@keyframes`, `animation`, `transition` | a PDF is one frame; an immutable version must re-render identically |
| `position: fixed`, `position: sticky` | undefined or hostile in paged media |
| `expression()`, `behavior:`, `-moz-binding` | dead execution vectors |
| `!important` | the injected frame must win the cascade |
| a selector matching a page element | `.page` is reserved (§4.3) |

### 4.3 The frame (#136, amended by #137)

The backend derives the `.page` rule from the definition and injects it during assembly. It owns
geometry and pagination only: `width`, `height`, `box-sizing`, `padding` (from `page.safeArea`),
`background`, `overflow`, `overflow-wrap`, `break-after`, **`contain: strict`**, and
`.page:last-child { break-after: auto }`. It also resets `html, body { margin: 0; padding: 0 }`, so
page `i` starts at `y = i·height` (§5.2). It does not set `display`.

A model-authored rule matching a page element is a violation, not a silent override: a model that
composed for the wrong canvas must repair, not render clipped.

### 4.4 Checker and violations (#136)

- **Parsers:** `parse5` (WHATWG-compliant, with `sourceCodeLocationInfo`) for markup; `postcss` for
  CSS. Both are new, worker-only dependencies. Regex matching is ruled out: its false positives
  burn Repair budget on findings the model cannot fix.
- **Size:** 256 KB on the Candidate Source, checked before parsing.
- **Pure:** `check(definition, candidate) => Violation[]`, no I/O, reporting **all** violations at
  once.
- **Reject only, never sanitize.**

```ts
type Violation = { code: string; detail: string; page?: number; line?: number };
```

- `code` holds two namespaces: Design System findings use the definition key path
  (`typography.scale`, `palette.rules.references`), and envelope findings use `envelope.*`. Render
  findings (§5.2) use `render.*` or a definition key path. `envelope.truncated` covers both an
  output cut off by the token cap and a source over 256 KB.
- No severity field: every finding is a hard reject.
- **All violations are recorded on the run** (§11.1). **A bounded list goes to the model:** at most 3
  per `code` with a count of the rest, at most 40 total.

### 4.5 Assembly (#136, #137)

Assembly turns a statically clean Candidate Source into a Document Source by adding exactly three
derived things:

1. **The frame stylesheet** (§4.3), as a second `<style>` block.
2. **The Google Fonts `<link>`**, built from `typography.fonts` ∩ `DESIGN_SYSTEM_FONT_ALLOWLIST`,
   `display=block`.
3. **Icons.** Each `<svg data-icon data-size>` placeholder is filled from the pinned Lucide catalog
   (`lucide-static`, catalog id `app-inline-v1`): `viewBox`, paths, `stroke="currentColor"`,
   `width`/`height` from `data-size`, `aria-hidden="true"`, `focusable="false"`.

- Inlining failure is terminal, never silent. After assembly, an assertion confirms no placeholder is
  left unfilled.
- Upgrading Lucide mints a new catalog id (`app-inline-v2`), handled like a contract change, not as a
  dependency update.
- The `url(` rule binds the Candidate Source only. Google's stylesheet legitimately references
  `fonts.gstatic.com`; never block gstatic.
- Assembly happens in `RENDER_PDF`, before the render, so the stored Document Source is byte-identical
  to what Browserless received.

## 5. Rendering and render validation

### 5.1 The session (#137)

One CDP session per render replaces the REST `/pdf` call. It uses `puppeteer.connect` to Browserless
(`puppeteer-core`, a runtime dependency) and is one metered render:

1. `setJavaScriptEnabled(false)`. CDP evaluation still runs the probe.
2. Request interception allowlists `fonts.googleapis.com/css2` and `fonts.gstatic.com` only. A
   refused request is recorded.
3. `emulateMediaType('print')`; viewport at the definition's page size.
4. `setContent(…, { waitUntil: 'load' })`. Not `networkidle0`, which never settles on Browserless.
5. Probe: force layout, `await document.fonts.ready`, collect page boxes, line boxes, colours,
   effective backgrounds, clipping ancestors and FontFace status.
6. Font pass: `CSS.getPlatformFontsForNode` per text element (`document.fonts.check()` cannot detect
   fallback).
7. Capture `cover.png` from page 1. This is best effort: a failure is recorded and never blocks
   `READY` (#138).
8. `page.pdf`, then count the PDF's pages.

One deadline covers the whole session, not only `setContent`.

### 5.2 The judge (#137)

`judge(definition, facts) => Violation[]` is pure. The probe measures; the judge decides.

| code | proves | remedy |
|---|---|---|
| `render.pages.geometry` | each page box is exactly the definition's size at `y = i·height` | repair |
| `render.pdf.pageCount` | PDF pages = page elements | repair |
| `render.pages.blank` | every page shows text or an icon | repair |
| `page.safeArea` | no visible text line or painted box crosses the safe area | repair |
| `render.overflow.clipped` | no text is hidden by an ancestor's `overflow` | repair |
| `render.overlap` | no two elements' visible text overlaps | repair |
| `render.fonts.fallback` | every glyph came from a declared family's face | repair |
| `palette.pairings` | each text colour on its effective background is a declared pairing | repair |
| `icons.colors` | each icon's inherited `currentColor` is an allowed token | repair |
| `render.fonts.failed` | no declared face failed to load | retry |
| `render.timeout` | the document loaded within budget | retry |
| `render.egress` | the session refused nothing | defect |

- Render findings have no `line`. The `detail` names the page, the element with a text snippet, and
  the distance, e.g. `page 2: p.body "Then cut the page…" crosses the bottom safe edge by 58px`.
- Glyph boxes are converted to line boxes (half-leading removed) with 1px tolerance.
- Only `repair` findings reach the model (§7.2). `retry` is handled by rendering again (§7.3).
  `defect` is a bug: terminal, alerted, never prompted.
- Known blind spots, measured by §11: pairings over gradients or images are skipped, as are
  translucent colours, occlusion other than text on text, and positioning outside the spacing scale.

### 5.3 Cost (#137)

A 2–4 page document takes 13–17 s on Browserless (one 30 s unit). The font pass and PDF streaming
scale with page count. If 15-page documents cross 30 s, the fix is Browserless's `/function` endpoint
running the same probe beside the browser (§11.5).

## 6. Artifact versions

### 6.1 Current Version (#138, every artifact type)

`currentVersion` is the **newest `READY` version**. It is absent until the first version becomes
`READY`, and it moves in exactly one place: the promotion write in `PERSIST_VERSION` (§7.6), in the
same update that sets `READY`. `appendRefineVersion` no longer moves it, and
`findLatestUsableContent` is deleted.

### 6.2 Attempts (#138, every artifact type)

- **At most one `GENERATING` Attempt per artifact.** `POST /refine` is `409` if any version is
  `GENERATING`, enforced by a conditional update.
- Version numbers are `max(versions) + 1`, never reused.
- A failed Attempt stays in `versions[]` forever as `{ version, status: FAILED, refineFeedback?,
  failureCode, failureReason, createdAt }` with **no content**. Its Candidate Source and violations
  are recorded on the `WorkflowRun` only (§11.1).
- Nothing retries or resumes a failed Attempt. Recovery is a new refinement of the Current Version.

### 6.3 Stored Document Version (#138, amending #135)

```ts
version: {
  version, status, createdAt, editedAt?, refineFeedback?, failureCode?, failureReason?,
  parentVersion?: number,              // refine base; absent on v1
  content: {
    commentary?: Commentary,
    document: {
      designSystemId: string,          // per-version pin, stamped server-side
      designSystemVersion: number,
      sourceKey: string,               // artifacts/{id}/{v}/source.html    (Document Source)
      sourceSha256: string,
      candidateKey: string,            // artifacts/{id}/{v}/candidate.html (accepted Candidate Source)
      candidateSha256: string,
      pdfKey: string,                  // artifacts/{id}/{v}/document.pdf
      pageCount: number,               // measured (§5.2)
      coverKey?: string,               // artifacts/{id}/{v}/cover.png, best effort
    }
  }
}
```

- HTML lives in R2, never inline in Mongo.
- **The pin is per version.** `Artifact.source.designSystemId?` records only what the user requested
  at creation and is never rewritten.
- There is no `slides`, `templateId` or `theme`. `CreateArtifactDto.theme`, `Artifact.source.theme`
  and `CarouselTheme` are removed. The content union stops accepting template versions.
- The Zod `READY` gate requires `sourceKey`, `candidateKey` and `pdfKey`.
- R2 objects are written before promotion, so a `READY` version always has them. The hashes make
  "frozen" checkable.
- **Retention.** Per-version objects are never deleted while the artifact is live. A future
  soft-delete sweep must skip versions referenced by a `SCHEDULED` or `PUBLISHED` Post. Objects from
  an Attempt that never reached `READY` stay under their own prefix for that sweep.
- A frozen Document Source references Google-hosted fonts that may one day stop being served. This
  never affects a stored PDF, because nothing re-renders a stored version (§6.6). Self-hosting fonts
  is the eventual fix and is out of scope.

### 6.4 Manual edit (#138)

`PATCH /artifacts/:id` on a DOCUMENT edits **`title` and `content.commentary` only**. Any key under
`content.document` is a `400` naming the field. Nothing is re-rendered; `editedAt` is recorded; the
pinned-Post `409` still applies.

Recorded, not built: future user edits to the document itself will **create a new version**
(`origin: 'EDIT'`), validated and assembled like any Candidate Source. A version is one immutable
document.

### 6.5 Refinement (#138)

- **The base is always the Current Version.** It is never a failed Attempt or an older `READY`
  version.
- **The prompt sees the base's Candidate Source** (`candidate.html`, verified against
  `candidateSha256`), never the assembled Document Source. Reverse-assembly is rejected.
- The prompt also carries the base's commentary, the user's `feedback`, the original `prompt` and
  `stylePreset`, the prompt fragment of the new Attempt's pin, and the prior run's research. There is
  no new research pass.
- The model re-emits the whole document, which goes through check → Repair → assemble → render.
- **Design System on refine:**
  1. By default the new Attempt carries the base's exact pin, whatever its status: `SUPERSEDED` and
     `RETIRED` refine normally.
  2. The only blocking case is a **non-consumable pin**: it does not resolve, or its `contract ≠
     SUPPORTED_CONTRACT`. This is a `409` with `code: 'design_system.unavailable'` and
     `{ designSystemId, designSystemVersion, designSystemName }`, checked in the request path before
     an Attempt is appended or credit is spent.
  3. Switching is explicit: `POST /refine { feedback, designSystemId? }` pins the new Attempt to that
     slug's `ACTIVE` version (`400` if not active or unlisted). It covers changing look, upgrading,
     and answering the `409`.
  4. A move is derivable by comparing a version's pin with its `parentVersion`'s.

### 6.6 Posts pin an exact version (#138)

- A Post pins `(artifact, version)` and **never follows** the Current Version. "Update to the latest
  version" is a client action through the existing post-edit path.
- Any `READY` version is pinnable. An absent `currentVersion` with no explicit `version` is a `400`.
- **Publish uploads the stored `pdfKey` bytes and never re-renders.**
- The pin CAS in `bumpArtifactPinRevision` (`post.service.ts`) changes from `currentVersion: version`
  to `versions: { $elemMatch: { version, status: 'READY' } }`. `pinRevision` now protects only the
  Current Version's commentary.
- A stale Design System pin never blocks posting.

### 6.7 Client reads (#138)

`serializeContent` becomes an **allowlist** for DOCUMENT:

```ts
content: {
  commentary?,
  document: {
    designSystemId, designSystemVersion, designSystemName,  // this version's pin
    pageCount,
    pdfUrl,             // signed, 1 h, minted per read
    pdfUrlExpiresAt,    // ISO
  }
}
```

- No key, hash or URL for either HTML object is ever serialized.
- `designSystemName` comes from the status-blind `resolve` cache.
- Non-`READY` versions (via `?version=`) return `content: {}`, plus `failureCode` and `failureReason`
  when `FAILED`.
- **List preview:** `firstSlide` is gone. It keeps `commentary`, `pdfUrl` and `pageCount`, and adds
  `coverUrl` (signed PNG of page 1, absent if the capture failed). Only current versions are signed.

### 6.8 Attempt reporting (#138)

```ts
currentVersion?: number
latestAttempt?: { version, status: 'GENERATING' | 'FAILED', failureCode?, failureReason?, runId }
status: 'GENERATING' | 'READY' | 'FAILED'   // derived
```

- `latestAttempt` is present only when the newest version is not the Current Version.
- `status` is derived: `GENERATING` if an Attempt is in flight, else `READY` if a Current Version
  exists, else `FAILED`. The `?status=` filter uses the same derivation.
- `GET /artifacts/:id` without `?version=` returns the Current Version, or the latest Attempt with
  `content: {}` if there is none.
- `POST /refine` returns `{ version, runId }`, where `version` is the Attempt's number.

## 7. Generation workflow

### 7.1 Shape (#139)

```
RESOLVE_INPUT → [RESEARCH] → GENERATE → RENDER_PDF → PERSIST_VERSION
```

The engine, `buildWorkflow` and the step list are unchanged; `total` stays exact. **There is no agent
loop**: generation and rendering each own a bounded, backend-driven fix loop inside their step, and
Repair rounds are `step.progress`, not steps.

- **`GENERATE`:** draft → static check → static Repairs until clean or out of budget.
- **`RENDER_PDF`:** assemble → render session → judge → on `repair` findings, a render Repair whose
  output is statically re-checked, re-assembled and re-rendered. The step gains `ctx.agent` and the
  checker.

Rejected: engine backward edges, which break the linear model; one composite step, which makes a
render timeout indistinguishable from a model turn; and an agent loop, which makes validation
optional and Browserless sessions model-discretionary. **Reopen the loop** if visual review returns
or page-scoped repair proves necessary.

### 7.2 Repair budget (#139)

- **`DOCUMENT_REPAIR_BUDGET = 2`** Repair turns per job attempt, shared by static and render findings.
  The Zod/JSON repair turn in `agent.generate` counts against it for DOCUMENT.
- Only `repair`-remedy codes spend budget.
- **A candidate reaches Browserless only once it is statically clean.**
- **Exhaustion is terminal** (`document.repair_exhausted`). Recovery is a refine.
- Worst case per job attempt: 3 model writes and 3 judged render sessions.
- **A Repair is a fresh two-message call.** The system message is the generation prompt plus the
  pinned fragment, byte-identical to the draft call. The user message is the current Candidate
  Source, the bounded violations, and "fix these, re-emit the complete document, change nothing
  else". Brief, research and feedback are dropped.
- A Repair's `title` and `commentary` are ignored; the draft's are kept.

### 7.3 Render retries and the checkpoint (#139)

- `render.timeout` and `render.fonts.failed` **retry once in-step**: a fresh session on the same
  Document Source after ~2 s, no Repair spent.
- Before rendering, the step saves the latest statically clean Candidate Source and the Repairs spent
  to the run as **`acceptedCandidate`**. If the retry also fails, the step throws **transient**.
- **On replay, `GENERATE` returns the checkpoint without calling the model.** It still emits its
  events, so the step list stays honest. This is the job's only checkpoint.
- `render.egress` is **terminal** and alerts.

### 7.4 `RESOLVE_INPUT` (#139)

For DOCUMENT it loads the pinned definition (`resolve`), its memoised fragment, and, on REFINE, the
base's `candidate.html` and commentary.

| Case | Class |
|---|---|
| Pin does not resolve | **terminal** + alert `design_system.unresolvable` |
| `contract ≠ SUPPORTED_CONTRACT` | **transient** (deploy skew; heals when the worker rolls) |
| R2 read of `candidate.html` fails | transient |
| `candidate.html` missing or hash mismatch | **terminal** + alert `artifact.source_missing` |
| Mongo or cache read fails | transient |

All of these precede any spend.

### 7.5 Model output and truncation (#139)

- The model emits **JSON `{ title?, commentary, html }`** through the existing `responseSchema` path.
  `html` is the Candidate Source; `title` is used only on INITIAL.
- The LLM layer surfaces **`finishReason`** (`openrouter.strategy.ts` ignores it today). `length`
  raises `envelope.truncated` **before any parse**.
- **Truncation is terminal** (`document.truncated`) and spends no Repair.
- **`DOCUMENT_GENERATION_MAX_OUTPUT_TOKENS`, default 16384**, applies to DOCUMENT draft and Repair
  calls. `GENERATION_MAX_OUTPUT_TOKENS` (8192) keeps serving POST, POLL and research.
- **`DOCUMENT_RUN_DEADLINE = 6 min`** per job attempt, checked before each model call and render
  session. Exceeding it is transient. On exhaustion the code follows the phase: `render.unavailable`
  in `RENDER_PDF`, `internal` elsewhere.

### 7.6 Persistence and promotion (#139)

- **`RENDER_PDF` uploads.** After the judge passes it writes `candidate.html`, `source.html`,
  `document.pdf` and, best effort, `cover.png` under `artifacts/{id}/{v}/`, and puts keys, hashes and
  `pageCount` in run state.
- **`PERSIST_VERSION` promotes** with one conditional update that sets content, `READY` and
  `currentVersion`. Its filter is `{ _id, 'versions.version': v, 'versions.status': 'GENERATING',
  deletedAt: { $exists: false } }`.
- **Idempotent:** a replay that matches nothing because `v` is already `READY` with the same
  `sourceSha256` is success.
- **Soft-deletion mid-run is terminal**: run `FAILED`, no credits, no client message.

### 7.7 Usage settlement (#139, #142)

- **Every LLM turn in the winning job attempt is billed**: draft, Zod repair, static and render
  Repairs, one meter record per turn, so `usage.tick` climbs during Repairs.
- **Render is one `pdf_render` record per run**, written when `RENDER_PDF` completes and priced
  `max(CREDIT_MINIMUM_PDF_RENDER, CREDIT_SURCHARGE_PDF_RENDER × Σ units)` over sessions that produced
  a verdict (pass or `repair` findings). A clean run costs what it does today; the minimum applies
  once per run.
- Sessions without a verdict (`render.timeout`, `render.fonts.failed`, `render.egress`) are absorbed.
- Every session appends to the run's existing `renderAttempts` list, which gains `billed: boolean`.
- A checkpoint-resumed draft is not re-billed.
- There is no mid-run balance check; a run overshoots by at most its bounded worst case.

### 7.8 Events and failure codes (#139)

`step.progress` vocabulary for DOCUMENT, counts only and never violation details:

```ts
GENERATE:   { phase: 'draft' }
          | { phase: 'repair', round: 1 | 2, violations: number }
RENDER_PDF: { phase: 'render', session: number }
          | { phase: 'retry', cause: 'timeout' | 'fonts' }
          | { phase: 'repair', round: 1 | 2, violations: number }
```

`round` is the shared budget counter.

**`run.failed` gains a stable `code`** beside `failureReason`, for every artifact type (POST and POLL
emit `internal`). The failed Attempt stores the same pair.

| `code` | Cause | `failureReason` |
|---|---|---|
| `document.repair_exhausted` | still failing after 2 Repairs | We couldn't get this design to fit cleanly. Try refining with a shorter brief or another design. |
| `document.truncated` | `finishReason: length` or source over 256 KB | This document was too long to generate. Try fewer pages or a shorter brief. |
| `design_system.unavailable` | unresolvable, or stale after retries | This design is unavailable. Try again with another design. |
| `render.unavailable` | render outage after in-step retry and job retries | We couldn't render your document right now. Please try again. |
| `artifact.source_missing` | `candidate.html` missing or mismatched | This version can't be refined. Refine the current version again or create a new document. |
| `internal` | everything else, including egress | Something went wrong. Please try again. |

## 8. Visual review

**Omitted at launch** (#133, grounded in #132's research, `docs/ai-document-visual-review-research.md`).
The deterministic checks (§4, §5) plus the Zod envelope are the whole quality gate.

- The best published benchmark puts multimodal models near random on text overflow (F1 20.4%) and
  container overlap (31.2%). Six of seven target defect classes are detected for free in the paid
  Browserless session.
- No image-input path is built: `LLMMessage.content` stays a string.
- No review step, so the step list stays a pure function of `(type, withResearch, kind)`.
- **Reopen** with a fresh ticket citing recorded data: user reports of visual defects on `READY`
  documents that passed the checks (§11.5), or generation costs near the output cap, which would make
  a small-model review +2% of a run instead of +16%.

## 9. Client API changes

Applied in the build, each in the same commit as its code and its `apps/web` caller (`AGENTS.md`).
Nothing below is in `docs/api/` until then.

| Doc | Endpoint | Change | Slice |
|---|---|---|---|
| — (new `design-systems.md`) | `GET /design-systems` | new: `[{ id, version, name, summary, previews }]` | S1 |
| — (new) | `GET /design-systems/:id/:version/previews/:n.png` | new | S1 |
| `artifacts.md` | `POST /artifacts` | remove `theme`; add `designSystemId?` (`400` if not `ACTIVE`/listed; default `margin`) | S5 |
| `artifacts.md` | `POST /artifacts/:id/refine` | add `designSystemId?`; `409` when an Attempt is in flight; `409 design_system.unavailable` with pin and name; "appends an Attempt", not "increments `currentVersion`"; base is the Current Version | S6 |
| `artifacts.md` | `GET /artifacts` | `firstSlide` → `coverUrl`; add `currentVersion?`, `latestAttempt?`; `status` and `?status=` derived | S7 |
| `artifacts.md` | `GET /artifacts/:id` | DOCUMENT content is the §6.7 allowlist with `pdfUrlExpiresAt`; returns Current Version or latest Attempt; `failureCode` on failed versions | S7 |
| `artifacts.md` | `PATCH /artifacts/:id` | DOCUMENT: `title` and `content.commentary` only; `400` naming any `content.document` key | S7 |
| `runs.md` | SSE | `run.failed` gains `code` (§7.8); DOCUMENT `step.progress` vocabulary; remove "PDF rendering is atomic" | S5 |
| `posts.md` | create, schedule, publish | any `READY` version pinnable; a pinned Post never follows refines; `400` when there is no Current Version and no `version` | S6 |
| `README.md` | index | link `design-systems.md` | S1 |

## 10. Configuration and constants

| Name | Kind | Value | Owner |
|---|---|---|---|
| `SUPPORTED_CONTRACT` | module constant | `1` | §3.3 |
| `DEFAULT_DESIGN_SYSTEM_ID` | module constant | `'margin'` | §3.4 |
| `DESIGN_SYSTEM_FONT_ALLOWLIST` | module constant | twelve families (§3.6) | §3.6, §4.5 |
| `UNLISTED_DESIGN_SYSTEMS` | module constant | `[]` until the eval says otherwise | §3.4, §11.4 |
| Icon catalog | module constant | `lucide-static`, pinned, id `app-inline-v1` | §4.5 |
| Candidate size cap | module constant | 256 KB | §4.4 |
| Violations to the model | module constant | ≤3 per code, ≤40 total | §4.4 |
| `DOCUMENT_REPAIR_BUDGET` | module constant | `2` | §7.2 |
| `DOCUMENT_RUN_DEADLINE` | module constant | 6 min | §7.5 |
| `DOCUMENT_GENERATION_MAX_OUTPUT_TOKENS` | env var | `16384` | §7.5 |
| `CHROME_PATH` | env var, test only | local Chrome for `test:render` | §11.2 |
| Candidate retention on runs | module constant | 90 days | §11.5 |

Module constants change by deploy, never by environment, so a document never renders differently per
environment. Existing `CREDIT_SURCHARGE_PDF_RENDER` and `CREDIT_MINIMUM_PDF_RENDER` keep their values
with the per-run rule in §7.7. New dependencies: `yaml`, `parse5`, `postcss`, `lucide-static`.

## 11. Tests, eval, observability and rollout

### 11.1 Run diagnostics (#141)

Each DOCUMENT run records a **`documentDiagnostics`** block on `WorkflowRun`:

- per candidate: every check outcome (passes included), with violation codes and counts
- repair rounds used, `finishReason`, output tokens, page count, the pin, wall time per step and the
  final `failureCode`
- a reference to `renderAttempts` for session durations, units, outcome and `billed`, rather than a
  copy
- `acceptedCandidate` (§7.3) and, on failure, the failed Candidate Source

### 11.2 Test layers (#141)

| Layer | Covers | In `bun run check` |
|---|---|---|
| 1. Pure units | definition parse and the 13 seed errors, the font allowlist, icon-in-catalog, version and checksum rules; **one failing and one passing fixture per violation code**; the judge on recorded probe facts; assembly (frame, font link, icons, no-unfilled assertion); the checker-bypass corpus | yes |
| 2. Seed conformance | every `assets/design-systems/*` definition parses, and its `sample.html` checks with zero violations and assembles | yes |
| 3. Workflow integration | scripted fake agent and renderer; one test per §7 path: clean; static Repair; exhaustion; render Repair; truncation; in-step retry; transient then checkpoint resume; egress; deletion mid-run; stale contract; persist replay; refine pin carry and `candidate.html` read. Each asserts step events, `step.progress`, meter records (billed vs absorbed) and `failureCode` | yes |
| 4. Real-browser render | local Chrome against the six samples (no violations; PDF pages = pages) and a hostile/defect corpus, with an exact verdict per fixture | **no**: `bun run test:render`, required before merging renderer or judge changes |

`test:render` reads `CHROME_PATH` and fails clearly when it is unset. `puppeteer-core` stays a
runtime dependency.

**Checker-bypass corpus**, each case asserting the exact `code`:

- `url(` disguised by CSS escapes, comments, case, `image-set` or `@import`
- `.page` reached via `:is()`, `:where()`, `[class~=page]`, `section`, `body > *` or `*`
- `!important` variants, and `</style>` inside a CSS string
- `<svg>` with children, `<foreignObject>`, or `<script>` inside `svg`
- `on*` in any case, and entity-encoded attribute names
- nested `<section>`, `<template>`, comment and CDATA tricks
- the 256 KB boundary, and unclosed (truncated) input

A bypass found later becomes a fixture before it becomes a fix.

### 11.3 Pre-rollout eval (#141)

`bun run eval:documents` runs the real model and real Browserless, writes normal diagnostics, and
prints §11.5's aggregates. There are 20 runs: 6 systems × a 4-, 8- and 15-page brief, plus 2 refines
(one carrying the pin, one switching system).

| Gate (counts over 20) | Pass |
|---|---|
| Runs failing | ≤ 1 |
| `document.truncated` | 0 |
| `render.egress` and any alert | 0 |
| Slowest run | ≤ 4 min |
| Most expensive successful run | ≤ 3× the cheapest at the same page count |
| Per system (3 runs) | 0 failures to list it; 1 failure → re-run its 3 or ship it unlisted; 2+ → unlisted |

First-candidate pass rate is recorded, not gated. One person reviews every `READY` run's cover for
text over gradients and positioning that escapes the spacing scale.

### 11.4 `UNLISTED_DESIGN_SYSTEMS` (#141)

`listActive` and `getActive` filter on this constant. A create or refine request naming an unlisted
system is a `400`; existing pins still resolve. Changing it is a deploy. **`DEFAULT_DESIGN_SYSTEM_ID`
may never be unlisted** (§3.3), so a default that fails the eval blocks rollout until it passes or the
default changes to a system that passed.

### 11.5 Monitoring (#141)

- **No new vendor.** Metrics are Mongo aggregations on read through an admin-guarded
  **`GET /diagnostics/documents?since=`** beside `GET /diagnostics/heap`. It returns, overall and per
  system: runs, `READY` rate, `failureCode` breakdown, first-candidate pass rate, repair-rounds
  histogram, top 10 violation codes (static and render), truncations, render sessions per run with
  retries and absorbed units, wall time p50/p95, and credits p50/p95.
- **Alerts** are `logger.error('[ALERT <tag>] run=… artifact=…')` lines, matched by Railway log
  search. Fixed tags: `render.egress`, `design_system.unresolvable`, `artifact.source_missing`,
  `icon.inline_failed`, `credit.commit_failed`.
- **Weekly review.** Every trigger needs ≥ 50 runs in the window.

| Signal | Trigger | Action |
|---|---|---|
| a system's `READY` rate | < 90% | unlist it, fix the definition, bump `version` |
| overall `READY` rate | < 95% | read the top `failureCode`; tune per the rows below |
| `repair_exhausted` share of failures | > 50% and round-2 success > 30% | raise `DOCUMENT_REPAIR_BUDGET` to 3 |
| truncations | > 1% of runs | raise `DOCUMENT_GENERATION_MAX_OUTPUT_TOKENS` |
| p95 wall time | > 4 min | profile; move the probe to Browserless `/function` |
| one violation code | > 30% of Repairs | fix the prompt fragment for that code |
| any alert | ≥ 1 | same-day investigation |

- **Visual review's reopening signal** is a "report a problem" action on a document version. That is a
  frontend follow-up outside this specification. Until it exists, someone reviews 10 covers a week.
- **Retention.** Candidate Source text on runs (failed candidates, `acceptedCandidate`) expires after
  **90 days**, by a TTL'd sub-document or a sweep. Run records and check outcomes are kept
  indefinitely.

### 11.6 Logging (#141)

- One structured completion line per DOCUMENT run: `runId`, `artifactId`, version, pin, outcome and
  `failureCode`, repair rounds, render sessions, wall time, credits.
- **Never logged:** Candidate or Document Source, prompts, briefs, research text, or violation
  details. They live only on the run record.

### 11.7 Rollout (#141, #142)

There are no real users, so the rollout is a cutover:

1. Deploy the worker, then the API. **Deploy rule, added to `docs/monorepo.md` in S9:** on a
   `contract` bump, the worker deploys before the API.
2. `bun run seed:design-systems`. Boot refuses to start without seeds.
3. **`bun run purge:template-documents`** (§12.2), before the new API serves traffic.
4. `bun run eval:documents` in the target environment. Systems that fail ship unlisted; a failing
   default blocks the rollout (§11.4).
5. There is no per-user flag and no dual pipeline. **Rollback is redeploying the previous release.**

## 12. Removal plan

### 12.1 Code and assets (#142)

Replaced, not deprecated: each removal lands in the same change as its replacement, and both
pipelines never coexist.

| Removed | Replaced by | Slice |
|---|---|---|
| `src/carousel/` renderer, template service, slide schemas, `templates.ts` | design-system module, checker, assembly, render session | S1–S5 |
| `assets/carousel/` (`base.css`, four themes) | `assets/design-systems/` | S5 |
| `docs/carousel-theme-preview.html` | design-system previews | S5 |
| `CarouselTheme`, `CreateArtifactDto.theme`, `Artifact.source.theme` | `designSystemId?` | S5 |
| `templateId` + `slides` content shape | §6.3 | S4 |
| `firstSlide` preview | `coverUrl` | S7 |
| `findLatestUsableContent`, head-pointer `currentVersion` | §6.1 | S4 |
| REST `/pdf` render path | CDP session | S3 |
| `src/carousel/prototype-*` | their production modules | as each lands |

`handlebars` stays: `src/mail/mail.service.ts` uses it for email templates.

### 12.2 Template-era data (#141, #142)

A one-off script, **`bun run purge:template-documents`**, with `--dry-run`, run once at cutover:

- deletes every DOCUMENT artifact with any `templateId` version
- deletes Posts referencing those artifacts unless `PUBLISHED`; `PUBLISHED` Posts are reported and
  kept, because LinkedIn already holds them
- deletes the purged artifacts' R2 objects
- logs counts per category

The read paths get **no fallback** for template versions. A leftover one is a cutover error that the
script fixes.

## 13. Build order

Vertical slices with dependencies. Issues are filed from this section in a separate pass after this
specification merges.

| Slice | Delivers | Depends on |
|---|---|---|
| **S1** Design Systems | contract (from the prototype), `design_systems` schema and indexes, `seed:design-systems`, boot verification, `listActive`/`getActive`/`resolve`, `GET /design-systems` and previews, font allowlist, `UNLISTED_DESIGN_SYSTEMS`, `DEFAULT_DESIGN_SYSTEM_ID` | — |
| **S2** Checker and assembly | `parse5`/`postcss` grammar checker, violations and bounding, frame, font link, icon catalog and inlining, test layers 1–2 | S1 |
| **S3** Render session and judge | CDP session, probe, judge, cover capture, page count, `test:render` | S2 |
| **S4** Version model | §6.1–§6.3 schema, Attempts, single in-flight rule, Zod `READY` gate, conditional promotion, `failureCode` | — |
| **S5** Document generation | `GENERATE` with static Repairs, `RENDER_PDF` with render Repairs, budget, `finishReason`, checkpoint, deadline, billing, progress vocabulary, `run.failed.code`, removal of the template pipeline and `theme`, create-time `designSystemId`, test layer 3 | S2, S3, S4 |
| **S6** Refinement and Posts | Candidate-based refine, pin carry, `designSystemId` switch, `design_system.unavailable`, Post pin CAS | S5 |
| **S7** Client reads | allowlist serializer, `coverUrl`, `latestAttempt`, derived status, DOCUMENT `PATCH` limits | S4 (S5 for `coverUrl`) |
| **S8** Diagnostics and eval | `documentDiagnostics`, `GET /diagnostics/documents`, alert tags, completion log, 90-day retention, `eval:documents` | S5 |
| **S9** Cutover | `purge:template-documents`, `docs/monorepo.md` deploy rule, rollout run, prototype deletion | S6, S7, S8 |

S1 and S4 can start in parallel. S7 can run beside S5 once S4 lands. The client-facing changes for
each slice are listed in §9.
