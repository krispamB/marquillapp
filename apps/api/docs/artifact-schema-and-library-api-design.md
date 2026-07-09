# Artifact Schema, Versioning & Library API — Design

> Status: design spec for wayfinder map #99, ticket #102 (grilling outcome).
> Author: generated for Christopher Pam. Decisions settled in a grilling session
> on 2026-07-09.
> Supersedes the current `src/database/schemas/artifact.schema.ts` (which has a
> `type` enum/type mismatch: `enum: ['html','text','structured']` on a field typed
> `ArtifactType`).

Feeds the final spec assembly (#110). Interlocking tickets are referenced inline
at each boundary.

## Framing (charter-derived givens)

- An **`Artifact` is a standalone, user-owned library entity** with its own
  collection and stable `_id` (charter #1). A `Post` (#106) *references* artifacts;
  this ticket designs the library in isolation from posting.
- Content types map to LinkedIn's model (per the #101 API research): a post is
  **commentary (text) + at most one mutually-exclusive content object** (poll *or*
  document). Poll+media / document+media are **not possible** — so an artifact is
  single-type.

---

## 1. Versioning spine — stable family + embedded versions

The **`Artifact` document is a stable "family."** Refine-after-completion appends a
new version; versions are an **ordered, embedded `versions[]` array** inside the
family.

- Each version is a **full payload snapshot** (not a diff) plus generation metadata.
- **Addressing:** `artifactId` resolves to `currentVersion` by default; a specific
  version is `artifactId` + version number (`?version=N`).
- Rendered PDFs live in R2 (only the URL + structured slides sit in the doc), so the
  family stays comfortably under Mongo's 16 MB limit even after many refines.

**Rejected:** version-as-its-own-document with a `rootId` (Git-object style) — buys
unbounded history + per-version querying we don't need, at the cost of a
"latest-per-root" aggregation on every list/get.

## 2. Status lifecycle

Status lives **on the version** (each generation has its own lifecycle):

```
GENERATING → READY
GENERATING → FAILED
```

- A version reaches `READY` only when its content is complete — for **documents**,
  that means the Browserless-rendered `pdfUrl` is populated. No separate `RENDERING`
  state; fine-grained progress is the SSE stream's job (#107), so the *persisted*
  status stays coarse.
- **No family-level status enum.** An artifact's library state derives from
  `currentVersion.status`, avoiding drift between two enums.
- **Soft-delete** via a family-level `deletedAt`, not a status value (deletion is
  orthogonal to generation).
- **Publish state is deliberately absent** — whether an artifact has been posted is a
  `Post` concern (#106); referencing an artifact from a post doesn't mutate it.

## 3. Schema

```ts
enum ArtifactType   { POST = 'POST', POLL = 'POLL', DOCUMENT = 'DOCUMENT' }  // fixed per family
enum VersionStatus  { GENERATING = 'GENERATING', READY = 'READY', FAILED = 'FAILED' }

Artifact {                          // top-level, user-owned library unit
  _id
  user:           ObjectId<User>
  type:           ArtifactType
  title?:         string            // editable display label for the library
  source:         { prompt: string; withResearch: boolean; stylePreset?: StylePreset }
  currentVersion: number            // → versions[].version
  versions:       ArtifactVersion[] // ordered, append-only (head is mutable)
  deletedAt?:     Date              // soft delete
  createdAt, updatedAt              // Mongoose timestamps
}

ArtifactVersion {                   // embedded subdocument
  version:        number            // 1-based
  status:         VersionStatus
  content:        ArtifactContent   // stored loosely (Object); Zod-validated at the app boundary
  refineFeedback?: string           // feedback that spawned this version (v1: none)
  editedAt?:      Date              // set when the head is manually PATCHed
  failureReason?: string            // set when FAILED
  createdAt:      Date
}
```

- `type` is **family-level** — you refine a poll into a better poll, never into a
  document.
- Content is stored as a loosely-typed object in Mongoose and validated by **Zod**
  per type at the app boundary (matching the repo split: Zod for structured/LLM
  data, `class-validator` for HTTP DTOs). This retires the enum/type mismatch —
  `type` standardizes on `ArtifactType`; content correctness is Zod's job.

## 4. Per-type content (Zod discriminated union on `type`)

```ts
// POST — text-only (the degenerate case; commentary is the whole thing)
{ commentary: string }

// POLL — commentary + poll (constraints from the #101 API research)
{ commentary?: string;
  poll: { question: string;            // ≤ 140 chars
          options: string[];           // 2–4 options, each ≤ 30 chars
          durationDays: 1 | 3 | 7 | 14 } }

// DOCUMENT — commentary + structured slides + rendered PDF
{ commentary?: string;
  document: { slides: Slide[];         // Slide internals defined by #108
              pdfUrl?: string;         // R2 URL, populated on render → gates READY
              pageCount?: number } }
```

- `Slide` is intentionally opaque here — **the carousel-template ticket (#108)**
  owns its shape (a slide is expected to be `{ templateId, fields }`, i.e. structured
  content that fills a curated HTML/CSS template, *not* raw HTML). #102 stores
  `slides` as an ordered array and lets #108's Zod schema validate the internals.
- The relationship is source→derived: `slides` is the editable source of truth;
  `pdfUrl` is the disposable Browserless render output (re-rendered on every refine
  or slide edit).

## 5. Refine vs. manual edit

**A version = one AI generation.** Manual edits do not create versions.

- **Initial generation** = version 1.
- **AI refine** (`POST /artifacts/:id/refine {feedback}`) → async run → **appends** a
  new version that becomes `currentVersion` (`GENERATING → READY`). Prior versions
  are retained, immutable. `refineFeedback` records the human-readable reason.
- **Manual edit** (`PATCH /artifacts/:id`) → **mutates the current version's content
  in place** (no new version), allowed only when the head is `READY`; stamps
  `editedAt`.
- **Revert is deferred** (future work). If added later: `POST
  /artifacts/:id/versions/:v/restore` that *copies* version `v` to a new head,
  keeping older versions immutable.

**Rejected:** every manual save as a new version — perfect audit trail, but explodes
history and muddies what "version" means.

## 6. Creation — async generation kickoff

`POST /artifacts` is not hand-authoring; it kicks off a generation run.

- Creates the `Artifact` immediately (`currentVersion=1`, version 1 `GENERATING`) and
  **enqueues a generation run on the new engine** (#103); responds `202
  {artifactId, runId}`. The client watches progress via SSE (#107) and/or polls
  `GET /artifacts/:id`.
- **Input:** `{ type, prompt, withResearch, stylePreset? }`.
  - `withResearch` is the research/no-research toggle from the #100 resolution — this
    is exactly where `quickPostLinkedin`/`insightPostLinkedin` collapse into one flow
    (research-off ≈ quick post, research-on ≈ insight post).
- **No `connectedAccount` at creation** — an artifact is account-agnostic until the
  user chooses to post it (charter #1). Account binding happens in the `Post` flow
  (#106). This is a deliberate change from today's `PostDraft`.

**Rejected:** synchronous create — research + LLM + PDF render take tens of seconds;
would hold the HTTP connection and bypass the SSE design.

## 7. Generation context persisted

Keep the *request*, drop the research guts (avoid the `PostDraft` bloat where
`userIntent`/`compressionResult`/`youtubeResearch` were heavy and `select()`-excluded).

- **Family-level `source: { prompt, withResearch, stylePreset? }`** — the original
  request; gives refine runs base context and the UI a "generated from…" line.
- **Version-level `refineFeedback?`** — the feedback that spawned each version.
- **Research/intermediate context is NOT stored on the artifact** — it's a **run
  concern**, living on the engine's run record (#103) / research agent (#104). If a
  refine needs cached research, that belongs on the run record, not the library doc.

## 8. HTTP surface

All routes under `api/v1`, behind `ClerkAuthGuard`, owner-scoped (`Forbidden` if the
artifact isn't the caller's — same pattern as `PostService`).

| Method | Route | Body / Query | Result |
|---|---|---|---|
| POST | `/artifacts` | `{type, prompt, withResearch, stylePreset?}` | `202 {artifactId, runId}` |
| POST | `/artifacts/:id/refine` | `{feedback}` | `202 {artifactId, version, runId}` |
| PATCH | `/artifacts/:id` | partial content edit (head, `READY` only) | `200` |
| GET | `/artifacts` | `?type&status&month&page` | list of **summaries** + `filters {availableMonths, types}` |
| GET | `/artifacts/:id` | `?version=N` / `?includeVersions=true` | current version (or a specific version / + version-metadata history) |
| DELETE | `/artifacts/:id` | — | `200` soft delete |

- **List returns lightweight summaries only** — `{id, type, title, status, updatedAt,
  preview}` (`status` from `currentVersion.status`; `preview` = commentary/first-slide
  snippet, plus `pdfUrl` for documents). Never carries version arrays. Excludes
  soft-deleted, sorted `updatedAt` desc, paginated. The `month` filter reuses the
  existing `getPosts` `%Y-%m` aggregation; the `filters` block mirrors today's posts
  endpoint minus `connectedAccountIds` (artifacts are account-agnostic).
- **Get** returns the current version's full content by default; `?version=N` for a
  specific version; `?includeVersions=true` adds **version metadata only**
  (`{version, status, createdAt, editedAt, refineFeedback}`) for a history sidebar.
- **Delete** is soft (`deletedAt`); R2 PDF cleanup is a later background sweep, not
  inline.
- **R2 PDF key convention:** `artifacts/${artifactId}/${version}/document.pdf`
  (version-scoped so refines don't clobber prior renders).

## 9. Boundaries (owned by other tickets)

| Concern | Owner |
|---|---|
| `Slide` internal shape / carousel templates | #108 |
| Generation engine internals + the run record (holds research context) | #103 |
| Research agent (`withResearch`) | #104 |
| Post binding, connected-account, publish | #106 |
| SSE progress-event contract | #107 |
| Credit gating on create/refine | #105 |
| Revert; background R2 cleanup sweep | future |

## 10. Migration note

Per the #100 resolution this is a clean write-over (relaunch, no users): the current
`Artifact`/`postArtifact`/`pollArtifact` types and `src/mark/artifact.service.ts`
are rebuilt to this design; no data migration. `src/mark` is dissolved (charter #9).
