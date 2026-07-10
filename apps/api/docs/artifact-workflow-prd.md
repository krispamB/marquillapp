# LinkedIn Artifact Workflow — PRD

> Status: **build-ready specification.** Assembled for wayfinder map #99, ticket #110.
> Compiled 2026-07-10 from the closed design tickets #100–#109 and their reports in `docs/`.
>
> This document is the **destination** of map #99. It supersedes the individual design
> reports wherever they conflict: §2 records every cross-ticket seam this ticket ratified,
> and the sibling docs are henceforth read *through* §2. Everything below is a given for
> the build effort; the implementation tickets in §12 are the units of work.

## Contents

1. [What we are building](#1-what-we-are-building)
2. [Ratified resolutions — read this before the design docs](#2-ratified-resolutions)
3. [Corrections to stale claims in the design docs](#3-corrections-to-stale-claims)
4. [Domain model](#4-domain-model)
5. [The workflow engine](#5-the-workflow-engine)
6. [Step pipelines](#6-step-pipelines)
7. [The agent loop](#7-the-agent-loop)
8. [The carousel template system](#8-the-carousel-template-system)
9. [Credits](#9-credits)
10. [Post and publish](#10-post-and-publish)
11. [SSE progress streaming](#11-sse-progress-streaming)
12. [`src/mark` dissolution map](#12-srcmark-dissolution-map)
13. [Configuration](#13-configuration)
14. [Risks carried into the build](#14-risks-carried-into-the-build)
15. [Implementation tickets](#15-implementation-tickets)

---

## 1. What we are building

An **artifact library** for LinkedIn content. A user describes what they want; a
deterministic step pipeline running on a new workflow engine generates a typed
**Artifact** — a text post, a poll, or a document (PDF carousel) — streaming progress to
the browser over SSE. Artifacts live in the library as versioned, account-agnostic
drafts. Refining one appends a new version. When the user is ready, they bind an artifact
version to a connected LinkedIn account and publish or schedule it as a **Post**.

Generation is metered in **credits** backed by real provider cost. Research is an
optional per-run toggle served by a from-scratch agent loop with a single web-search
tool.

### Charter decisions (settled while charting map #99 — givens, not open questions)

1. **Artifacts are the library.** Content lives as an `Artifact` until the user chooses to
   post it.
2. **A new `Post` schema replaces `PostDraft`.** A post references *multiple* artifacts
   (leaving room for a future image artifact). This is a **complete write-over**: a
   relaunch with no existing users, so `postdrafts` is dropped and rebuilt clean. No
   backfill, no `_id` preservation, no coexistence window, no versioned API endpoints.
3. **One new workflow engine, one build flow.** The old engine is absorbed, not preserved:
   `quickPostLinkedin` and `insightPostLinkedin` fold into a single artifact-build flow as
   a research-on/research-off toggle chosen before the build starts. The old engine is
   deleted.
4. **Workflows execute in the BullMQ worker.** Step events land in Redis keyed by run id;
   the HTTP server relays them over SSE.
5. **Iteration is refine-after-completion.** Feedback triggers a refine run producing a new
   artifact version. No mid-run pause/resume.
6. **The agent loop is new and generic,** built on `src/llm` extended with tool-calling.
   The research agent (Tavily `searchWeb`) is the first and only agent at launch.
7. **Carousel slides are curated HTML/CSS templates** filled with AI-generated structured
   content, rendered through the existing Browserless→PDF path.
8. **Usage gating is token-backed credits** per tier per period. Non-LLM actions (web
   search, PDF render) carry fixed credit surcharges.
9. **`src/mark` is absorbed and dissolved.** Its surviving utilities migrate into the new
   modules; the module is deleted. `artifact.schema.ts` is redesigned.

### Explicitly out of scope

Rebuilding the autonomous Mark agent. Image-generation artifacts (the multi-artifact
`Post` shape leaves room; the artifact type itself is later work). Mid-run checkpoint
pause/resume. Token streaming. Credit top-ups, overage billing, rollover, mid-run credit
cutoff. Artifact version revert. Background R2 cleanup sweep.

---

## 2. Ratified resolutions

The design tickets were grilled in parallel and left seven seams open or contradictory.
**#110 closes all seven.** Where a sibling doc disagrees with this section, this section
wins.

### R1 — `pdfUrl` is renamed `pdfKey` everywhere

**Conflict.** #102 §4 stores `document.pdfUrl?`; #103 §2–3 writes `render: { pdfUrl }`;
#106 §5 publishes from "the artifact version's R2 `pdfUrl`"; #107 §3 gates READY on it.
#108 §7 discovered the R2 bucket is **private** — `uploadFile` returns an
`…r2.cloudflarestorage.com` URL nothing can serve to a client — and renamed the field.

**Ratified: `pdfKey`.** The artifact version stores the R2 **object key**, not a URL.
Clients receive a short-lived signed URL minted via the existing `getSignedUrl(key)` at
response-serialization time. Publish fetches bytes server-side via `getFile(key)`, exactly
as `linkedin-media.service.ts` already does. Propagate the rename to #102 §4, #103 §2–3,
#106 §5, #107 §3. Semantics are unchanged: `pdfKey` still gates `READY`.

### R2 — a post-repair Zod failure at `GENERATE` is terminal

**Conflict.** #103 §7 classes "Zod-invalid LLM output after a step's own internal retries"
as terminal. #104 §8 says "still invalid → throw `retryable`." #108 §3 flagged the seam;
#109 §8 resolved it and asked #110 to ratify.

**Ratified: terminal.** `GENERATE` gets two failure arms:

| Failure at `GENERATE` | Classification |
|---|---|
| LLM transport error (429 / 5xx / network) | `retryable` — rides the `attempts: 3` budget |
| Zod-invalid output surviving the one inline repair retry | **terminal** — `UnrecoverableError` |

The reasoning that decided it: `generate()` already performs one **inline repair retry**
re-prompting with the exact Zod error — a warm resample with the failure context in the
prompt. A BullMQ whole-job retry restarts cold from step 1 with that context gone, so it is
a *worse*-informed resample than the one that just failed. #104 §8's counter-argument
("cheap, because research is cached") is **false for INITIAL runs**: a retried INITIAL
research run re-executes `RESEARCH` (the builder keeps the step for `kind === INITIAL`;
only REFINE reads cached research), so the retry buys a full fresh Tavily pass plus a cold
generation. And the user is not stuck — `FAILED` versions stay visible in the library
(#102 §2), so a human-in-the-loop refine with adjusted feedback is strictly more useful
than a blind retry.

**Amend #104 §8's migration note accordingly.**

### R3 — `StepContext` gains a `renderer` role

**Gap.** #103 §10's `StepContext` exposes `agent / artifacts / meter / emit / run / logger`
— no renderer. But #108 §6 and #109 §2 both have `RENDER_PDF` call
`CarouselRendererService`. #109 §9 handed the placement to #110.

**Ratified: a narrow `renderer` role interface,** consistent with the engine's
"depend on interfaces, not concrete services" principle:

```ts
interface CarouselRenderer {
  render(input: { artifactId: string; version: number; templateId: CarouselTheme; slides: Slide[] })
    : Promise<{ pdfKey: string; pageCount: number }>;
}

interface StepContext {
  logger:    Logger;
  agent:     AgentRunner;       // #104
  artifacts: ArtifactWriter;    // #102
  meter:     CreditMeter;       // #105
  renderer:  CarouselRenderer;  // #108 — added by R3
  emit:      (e: { type: RunEventType; data: unknown }) => void;  // step.progress only
  run:       RunRecordHandle;
}
```

`CarouselRendererService` implements it and is resolved once in the worker bootstrap
alongside the other roles. `RENDER_PDF` then mocks as trivially as every other step under
the repo's manual-construction test style.

### R4 — `StylePreset` (voice) and `CarouselTheme` (look) are different things

**Collision, caught during assembly — no sibling doc saw it.** `StylePreset` **already
exists** in the repo (`src/agent/style-presets.config.ts`) as a **writing-voice** enum —
`professional | storytelling | educational | bold | contrarian | founder` — driving
`STYLE_PRESET_INSTRUCTIONS` in the generation prompts and already persisted on
`PostDraft.stylePreset`. #108 §1 redefined the same name as a **carousel visual theme**
(`bold | minimal | editorial | gradient`), and #102 §6 / #109 §2 thread `stylePreset?`
through the create input to be stamped onto `document.templateId`. Only `bold` appears in
both value sets, meaning one literal would carry two unrelated meanings.

**Ratified: split the two concepts.**

- **`StylePreset` keeps its existing meaning and its six values** — the *voice* of the
  prose. It applies to **every** artifact type: a POST, a POLL's question, and a
  DOCUMENT's slide copy all have a voice.
- **`CarouselTheme` is new** — `'bold' | 'minimal' | 'editorial' | 'gradient'` — the
  *look* of a deck. It is meaningful **only for DOCUMENT** artifacts and is what
  `document.templateId` stores.

Consequences:

```ts
// create input (#102 §6), amended
{ type: ArtifactType; prompt: string; withResearch: boolean;
  stylePreset?: StylePreset;   // voice   — any type
  theme?: CarouselTheme }      // look    — DOCUMENT only

// Artifact.source (#102 §3), amended
source: { prompt: string; withResearch: boolean; stylePreset?: StylePreset; theme?: CarouselTheme }

// DOCUMENT content (#102 §4 + #108 §1), amended
{ commentary?: string;
  document: { templateId: CarouselTheme; slides: Slide[]; pdfKey?: string; pageCount?: number } }
```

The #108 §4 selection rule now reads on `theme`, not `stylePreset`: **user-supplied
`theme` is stamped authoritatively** by `GENERATE` (the model cannot override it); if
omitted, the model picks a `CarouselTheme` and Zod validates it is a real theme. Voice is
handled the way it is today — `resolveStylePresetInstruction(stylePreset)` injected into
the prompt — for all three types. Everywhere #108 says "`StylePreset` = theme id," read
`CarouselTheme`. `RunState.input` and `ResearchInput`/`GenerateInput` carry both fields.

Rejected — *repurpose `StylePreset` as the theme.* Every artifact type would carry a field
meaningful only for carousels, and the six voice-shaping prompt instructions would be lost
for no gain.

### R5 — the `UsageKind` for a render is `pdf_render`

**Conflict.** #103 §9 and #109 §2 write `ctx.meter.record({ kind: 'render', amount: 1 })`.
#105 §3 defines `type UsageKind = 'llm' | 'web_search' | 'pdf_render'`.

**Ratified: `pdf_render`.** #105 owns the `UsageKind` enum; the engine and the
`RENDER_PDF` step conform. The surcharge constant is `CREDIT_SURCHARGE_PDF_RENDER`.

### R6 — Redis Streams only; the pub/sub channel is dropped

**Conflict.** #103 §6 has the emitter "both publish [to a pub/sub channel] and append [to a
durable log]." #107 §4 adopts the Redis Stream as the single source and drops the pub/sub
relay entirely, because `XREAD BLOCK` unifies replay, live tail, and heartbeat cadence in
one mechanism with no subscribe-race.

**Ratified: `XADD` only.** The engine's sole emission side-effect is
`XADD workflow:run:{runId} MAXLEN ~ 1000`. No `PUBLISH`. The HTTP relay reads with
`XREAD BLOCK`. On the terminal event the engine sets
`EXPIRE workflow:run:{runId} 3600`.

### R7 — `RENDER_PDF` emits no `step.progress`

**Conflict.** #107 §3 floats a `pageRendered` progress signal from the render step. #108 §6
and #109 §2 both say there is nothing honest to emit: the render is a single atomic
`htmlToPdf` call with no observable intermediate state.

**Ratified: none.** The core's `step.started` / `step.completed` bracket the render. The
`step.progress` event stays in the vocabulary for `RESEARCH`'s `sourcesFound` only.
`step.progress` remains optional, step-defined, and best-effort — never a required
checkpoint for clients.

---

## 3. Corrections to stale claims

Facts asserted by the design docs that no longer hold against the current tree. Verified
against `HEAD` on 2026-07-10.

| Claim | Where | Reality |
|---|---|---|
| "the `MarkRun` doc" is prior art; "the `MarkRun` collection is deleted with the rest of `src/mark`" | #105 §5, §11 | **No `MarkRun` collection exists.** Nothing to delete. The prior art for a per-period consumption meter is `FeatureGatingService.assertMarkTokenQuota` / `incrementMarkTokenUsage` + the `mark_tokens` `FeatureKey`, and that is all. |
| "mirroring how `MarkUsageService` sat above the gating service today" | #105 §4 | **No `MarkUsageService` exists.** The layering it describes (a conversion service above `FeatureGatingService`) is sound, but it is new construction, not a mirror. |
| "retire all `MARK_*` config" | #104 §9, §12; #105 §5, §11 | **No `MARK_*` keys remain in `.env.example`.** The retirement is already done. What *does* remain is `FEATURE_KEYS.MARK_TOKENS` and the `'mark_tokens'` arm of the `Feature` union — those are R-renamed to `credits` (§9). |
| "add `TAVILY_API_KEY`" | #104 §12 | Already present in `.env.example:34`. No-op. |
| "the `compression` filter already excludes the streaming `/mark/chat` route … add the SSE route to the same exclusion" | #107 §7 | The exclusion at `main.ts:20` is **dead** — no `/mark/chat` route or Mark controller exists. **Replace** that line with the SSE exclusion rather than adding a second one. |
| `src/mark/utils/index.ts` exports the html/pdf utils | implied by #108 §11 | It exports only `html.utils` and `post.util`. `html_to_pdf.util.ts` and `poll.util.ts` are unexported and have **no callers anywhere**. |
| "`src/mark/artifact.service.ts` … rebuilt to this design" | #102 §10 | Correct, but note `ArtifactService` is the *only* provider `MarkModule` supplies, and `src/database/schemas/artifact.schema.ts` imports `postArtifact`/`pollArtifact` from `src/mark/types/`. That import is the last hard edge binding `src/mark` into the app. |

Two further pre-existing defects the build must clear:

- **`artifact.schema.ts` has an enum/type mismatch**: `@Prop({ enum: ['html','text','structured'] })` on a field typed `ArtifactType` (`'post'|'poll'|'document'`). The schema is rebuilt wholesale (§4), so this dies with it.
- **`ArtifactType` case changes**: today `'post' | 'poll' | 'document'` (lowercase); the new enum is `POST | POLL | DOCUMENT` (uppercase values). No data to migrate.

---

## 4. Domain model

### `Artifact` — the library unit

A stable, user-owned **family** with an ordered, embedded, append-only `versions[]` array
and a `currentVersion` pointer. `type` is fixed per family — you refine a poll into a
better poll, never into a document.

```ts
enum ArtifactType  { POST = 'POST', POLL = 'POLL', DOCUMENT = 'DOCUMENT' }
enum VersionStatus { GENERATING = 'GENERATING', READY = 'READY', FAILED = 'FAILED' }

Artifact {
  _id
  user:           ObjectId<User>
  type:           ArtifactType
  title?:         string
  source:         { prompt: string; withResearch: boolean;
                    stylePreset?: StylePreset;    // voice  — R4
                    theme?: CarouselTheme }       // look   — R4, DOCUMENT only
  currentVersion: number
  versions:       ArtifactVersion[]
  deletedAt?:     Date            // soft delete
  createdAt, updatedAt
}

ArtifactVersion {                 // embedded subdocument
  version:         number         // 1-based
  status:          VersionStatus
  content:         ArtifactContent   // stored loose (Object); Zod-validated at the app boundary
  refineFeedback?: string
  editedAt?:       Date           // set when the READY head is manually PATCHed
  failureReason?:  string
  createdAt:       Date
}
```

**Status lives on the version**, never on the family — an artifact's library state derives
from `currentVersion.status`, so two enums cannot drift. Deletion is orthogonal:
soft-delete via a family-level `deletedAt`. **Publish state is deliberately absent** —
whether an artifact has been posted is a `Post` concern; referencing an artifact from a
post does not mutate it.

A version reaches `READY` only when its content is complete. For DOCUMENT that means
`pdfKey` is populated. There is no `RENDERING` state; fine-grained progress is the SSE
stream's job, so the *persisted* status stays coarse.

### `ArtifactContent` — a Zod discriminated union on `type`

```ts
// POST — text is the whole artifact
{ commentary: string }                                    // ≤ 3000 LinkedIn-counted chars

// POLL — commentary + inline poll (constraints from #101)
{ commentary?: string;
  poll: { question: string;          // ≤ 140 chars
          options: string[];         // 2–4, each ≤ 30 chars, mutually unique
          durationDays: 1 | 3 | 7 | 14 } }

// DOCUMENT — commentary + structured slides + rendered PDF
{ commentary?: string;
  document: { templateId: CarouselTheme;   // R4
              slides: Slide[];             // 2–15, shape owned by §8
              pdfKey?: string;             // R2 key — R1; gates READY
              pageCount?: number } }
```

Content is stored as a loosely-typed object in Mongoose and validated by **Zod** at the app
boundary, matching the repo split (Zod for structured/LLM data, `class-validator` for HTTP
DTOs).

Two constraints the design docs left implicit, both recovered from `src/mark/utils` before
those files are deleted (§12) and both now **part of the Zod union**:

- **`commentary` caps at 3000 characters**, counted the way LinkedIn counts them — by
  UTF-16 code unit, so an astral-plane emoji costs 2. `linkedInCharCount` from
  `post.util.ts` is the reference implementation and survives the dissolution for exactly
  this reason. Applies to all three types.
- **Poll options must be mutually unique** (case-insensitive, trimmed). `poll.util.ts`
  enforces this today; #101 does not state it and #102's schema omitted it. LinkedIn's
  behavior on duplicate options is untested, and a poll with two identical options is a
  product defect regardless.

### `Post` — a publish record, not a draft

In the `PostDraft` world the draft *was* the content. In the artifact world **the artifact
is the draft** — it lives `READY` in the library. So a `Post` is created **only when the
user acts to publish or schedule**. There is no `DRAFT` post stage, which collapses the
status enum to three states and removes a whole redundant lifecycle.

```ts
enum PostStatus { SCHEDULED = 'SCHEDULED', PUBLISHED = 'PUBLISHED', FAILED = 'FAILED' }

Post {
  _id                                            // = BullMQ jobId = data.postId
  user:             ObjectId<User>
  connectedAccount: ObjectId<ConnectedAccount>   // bound HERE, not on the artifact
  artifacts: [{ artifact: ObjectId<Artifact>, version: number }]   // PINNED; v1 length 1
  status:           PostStatus
  scheduledAt?:     Date
  publishedAt?:     Date
  channelPostId?:   string                       // LinkedIn URN from x-restli-id
  failureReason?:   string
  createdAt, updatedAt
}
```

`artifacts` pins `{ artifact, version }` rather than a bare id, because an artifact is
mutable — refine appends a version, `PATCH` edits the head in place. A post scheduled for
next Tuesday publishes the version approved today, even if the artifact is refined three
times before then. If the pinned version becomes unresolvable at fire time, the worker
fails the post gracefully (`FAILED`, reason `"source artifact unavailable"`) rather than
publishing stale or empty content.

The schema's `artifacts` array is real (charter #2) but **publish-composition enforces
LinkedIn's one-content-object rule** (#101 §4). For v1 a post binds exactly one artifact.

### `WorkflowRun` — the durable run record

```ts
enum RunKind   { INITIAL = 'INITIAL', REFINE = 'REFINE' }
enum RunStatus { RUNNING = 'RUNNING', COMPLETED = 'COMPLETED', FAILED = 'FAILED' }

WorkflowRun {
  _id:              ObjectId       // = runId = BullMQ jobId = Redis stream key suffix
  user:             ObjectId<User>
  artifact:         ObjectId<Artifact>
  targetVersion:    number
  kind:             RunKind
  status:           RunStatus
  input:            BuildInput
  currentStep?:     WorkflowStep   // updated at each boundary — SSE cold-start fallback
  researchContext?: ResearchResult // persisted when RESEARCH completes; refine reuses it
  creditsUsed:      number         // attempt-scoped accumulator, reset each attempt
  failureReason?:   string
  createdAt, updatedAt
}
```

One durable record per generation, 1:1 with a BullMQ job, giving a clean identity chain
**run ↔ job ↔ Redis stream**. It decouples durable state from BullMQ's eviction policy
(jobs are removed on completion). It never copies generated content — that lives on the
artifact version; the run holds only the `(artifact, targetVersion)` reference.

---

## 5. The workflow engine

A **linear ordered step list** over a **typed, progressively-built run state**. No DAG —
these flows have no real branching or fan-out; the variation axes are handled by
*composition*, not runtime edges.

### Composition

```ts
function buildWorkflow({ type, withResearch, kind }: BuildSpec): WorkflowDefinition {
  return {
    name: `artifact:${type}`,
    steps: [
      WorkflowStep.RESOLVE_INPUT,
      ...(withResearch && kind === RunKind.INITIAL ? [WorkflowStep.RESEARCH] : []),
      WorkflowStep.GENERATE,                                    // dispatches on type internally
      ...(type === ArtifactType.DOCUMENT ? [WorkflowStep.RENDER_PDF] : []),
      WorkflowStep.PERSIST_VERSION,
    ],
  };
}
```

**The emitted step sequence is honest** — only steps that actually run appear. This matters
because that sequence feeds the SSE progress stream and the progress-bar math, so `total`
is exact and the bar has no skipped-step gaps.

### Run state

The step list is assembled dynamically, so TypeScript cannot infer a fully-chained
input→output pipeline. The model is one `RunState` interface with typed, named optional
slots; each step returns a typed partial patch the engine shallow-merges.

```ts
interface BuildInput {
  type: ArtifactType; prompt: string; withResearch: boolean;
  stylePreset?: StylePreset;    // R4
  theme?: CarouselTheme;        // R4
  userId: string; artifactId: string; version: number; kind: RunKind;
}

interface RunState {
  input:    BuildInput;                                  // RESOLVE_INPUT
  research?: ResearchResult;                             // RESEARCH, or seeded on REFINE
  refine?:  { priorContent: ArtifactContent; feedback: string };  // RESOLVE_INPUT on REFINE
  content?: ArtifactContent;                             // GENERATE
  render?:  { pdfKey: string; pageCount: number };       // RENDER_PDF — R1
}

type StepHandler = (state: RunState, ctx: StepContext) => Promise<Partial<RunState>>;
```

Steps **read the slots they need** (guarding with a `WorkflowError` if a required upstream
slot is missing — a programming bug, not control flow) and **write only their own slots**
via the returned patch. The returned-patch style rather than in-place mutation gives the
event layer a clean "here is what this step produced" hook.

### Events

The engine core wraps each step, so lifecycle events are guaranteed complete and match the
honest builder sequence. **Steps emit only what the core cannot observe.**

| Event | Emitted by | `data` |
|---|---|---|
| `run.started` | core | `{ kind, type, steps: WorkflowStep[] }` |
| `step.started` | core (wrap) | `{ step, index, total }` |
| `step.completed` | core (wrap) | `{ step, index, total }` |
| `step.failed` | core (wrap) | `{ step, retryable, message }` — non-terminal, "retrying…" |
| `step.progress` | step via `ctx.emit` | `{ step, ...signal }` — `RESEARCH` only (R7) |
| `usage.tick` | `ctx.meter.record` | `{ kind, credits, detail? }` |
| `run.completed` | core | `{ artifactId, version }` |
| `run.failed` | core | `{ failureReason }` |

```ts
interface RunEvent { runId: string; seq: number; type: RunEventType; ts: number; data: unknown }
```

`seq` is a monotonic per-run integer the **core** assigns, starting at 1. Steps supply only
`{ type, data }`; the core stamps `runId` / `seq` / `ts`. `usage.tick` is emitted by
`meter.record` — the one call that both accounts and announces — so `ctx.emit` is reserved
for `step.progress`.

The emitter's **only** side effect is `XADD workflow:run:{runId} MAXLEN ~ 1000` (R6).

### Error and retry semantics

A retry re-runs the **whole** job from step 1 — there are no per-step checkpoints, because
charter #5 fixed no mid-run resume.

- **BullMQ:** `attempts: 3`, `backoff: { type: 'exponential' }`.
- **Taxonomy:** `WorkflowError { retryable: boolean; reason: string }`. Transient
  (`retryable: true`) rides the attempt budget. Terminal (`retryable: false`) is rethrown
  as BullMQ's `UnrecoverableError`, which stops retries immediately.

**Why whole-job retry is safe:** a run targets a *fixed* `(artifactId, version)` created as
`GENERATING` at kickoff. Every step, including `PERSIST_VERSION`, writes to that same fixed
version, so a retry *overwrites* rather than appending. No duplicate versions. The only
non-idempotent side effect is usage accounting, handled by the attempt-scoped reset (§9).

**Terminal-failure handler** (a job-level `failed` handler mirroring the existing
`media-upload` `exhausted` idiom), fired only on attempts-exhausted or `UnrecoverableError`:

1. Target version → `FAILED` with `failureReason`.
2. `WorkflowRun` → `FAILED` with `failureReason`.
3. Emit `run.failed { failureReason }`.
4. **No credit commit** — the user is not charged for a failed run.

Intermediate will-retry failures emit `step.failed` and leave the version `GENERATING`.

### Refine re-entry

A refine is a **new run** (`kind: REFINE`) over an existing artifact. `POST
/artifacts/:id/refine { feedback }` appends a new `GENERATING` version and returns
`202 { artifactId, version, runId }`, then kicks off the run that fills it.

`RESOLVE_INPUT` seeds `input` from the family-level `source`, plus
`refine = { priorContent, feedback }`, plus `research` **copied from the artifact's latest
`COMPLETED` `WorkflowRun.researchContext`**. The builder omits `RESEARCH` for
`kind: REFINE`, so refine re-charges no web-search surcharge and adds no latency. If the
original run was research-off there is simply no cached research, and `GENERATE` runs on
prompt + feedback alone.

---

## 6. Step pipelines

Nine `(type × kind × withResearch)` combinations — the 3 × 2 × 2 product minus the three
REFINE-with-research-on combos that cannot exist — collapse to **four distinct step-list
shapes**:

| Shape | Step list | Used by |
|---|---|---|
| **A** | `RESOLVE_INPUT → GENERATE → PERSIST_VERSION` | POST/POLL initial research-off; POST/POLL refine |
| **B** | A + `RESEARCH` | POST/POLL initial research-on |
| **C** | A + `RENDER_PDF` | DOCUMENT initial research-off; DOCUMENT refine |
| **D** | A + `RESEARCH` + `RENDER_PDF` | DOCUMENT initial research-on |

**POST and POLL share identical pipelines.** They differ only in `GENERATE`'s output shape
and in what `PERSIST_VERSION` Zod-validates. **DOCUMENT is POST/POLL + `RENDER_PDF`.** That
is the entire variation surface.

### The five steps

| Step | Kind | Metered | Conditional on |
|---|---|---|---|
| `RESOLVE_INPUT` | code | no | always |
| `RESEARCH` | **AI** (agentic tool loop) | `llm` per turn + `web_search` per call | `withResearch && kind === INITIAL` |
| `GENERATE` | **AI** (single completion) | `llm` per turn | always |
| `RENDER_PDF` | code (deterministic) | `pdf_render` fixed surcharge (R5) | `type === DOCUMENT` |
| `PERSIST_VERSION` | code | no | always |

Exactly two AI steps. Note that the AI/code axis and the metering axis are independent — a
code step can still be metered. The deterministic spine (`RESOLVE_INPUT`, `RENDER_PDF`,
`PERSIST_VERSION`) is what makes whole-job retry safe.

**`RESOLVE_INPUT`** — materializes the typed `RunState` from `job.data: BuildInput`. On
REFINE it additionally seeds `refine` (prior content + feedback) and `research` (from the
run-record cache). A missing target artifact/version is **terminal** — kickoff created
them, so absence is a bug, and re-running cannot fix it.

**`RESEARCH`** — calls `ctx.agent.research({ prompt, type, stylePreset })` → `ResearchResult
{ findings, sources }`. Writes the `research` slot **and** persists `researchContext` on the
`WorkflowRun` so a later refine reuses it with zero re-search. Emits optional
`step.progress { sourcesFound }`. Tool errors are absorbed in-loop; an LLM transport error
surfaces as `WorkflowError { retryable }` per `src/llm`'s classification.

**`GENERATE`** — calls `ctx.agent.generate(...)` → `ArtifactContent`, one `complete` call
with no tools, validated against the §4 Zod union with **one inline repair retry**.
Dispatch on `type`. For DOCUMENT, `templateId` resolution happens **inside this step**: a
user-supplied `theme` is stamped authoritatively (the model cannot override it); if omitted
the model picks one and Zod validates it is a real `CarouselTheme` (R4). `slides` is the
only thing set here — `pdfKey` and `pageCount` are `RENDER_PDF`'s job. Failure arms per R2.

**`RENDER_PDF`** — calls `ctx.renderer.render(...)` (R3), which owns
`assembleHtml → htmlToPdf → uploadFile`. Writes `render = { pdfKey, pageCount:
slides.length }`. Emits **no** `step.progress` (R7) and one
`ctx.meter.record({ kind: 'pdf_render', amount: 1 })` (R5). A Browserless timeout is
**retryable**; an unknown `templateId`/`slide.type` at assembly is **terminal** (Zod already
validated the content, so it cannot occur and re-running cannot fix it).

**`PERSIST_VERSION`** — calls `ctx.artifacts.setVersionContent(artifactId, version, content,
render?)`: writes `content`, folds `render.pdfKey` + `pageCount` into `content.document` for
documents, and flips `GENERATING → READY`. The run's only durable content write. On
`run.completed` the engine calls `meter.commit(runId)` — the **only** real credit debit,
charged once for the winning attempt. A DB write error is retryable; the write targets the
fixed `(artifactId, version)`, so a retry overwrites rather than appends.

### Run-state slot lifecycle

| Slot | Set by | Read by |
|---|---|---|
| `input` | `RESOLVE_INPUT` | every downstream step |
| `refine` | `RESOLVE_INPUT` (REFINE only) | `GENERATE` |
| `research` | `RESEARCH`, **or** `RESOLVE_INPUT` on REFINE (from cache) | `GENERATE` |
| `content` | `GENERATE` | `RENDER_PDF` (document), `PERSIST_VERSION` |
| `render` | `RENDER_PDF` (document only) | `PERSIST_VERSION` |

`research` has two producers and one consumer; `GENERATE` reads it agnostic of origin.
`content` is the hinge — the AI product every downstream code step renders or persists.

### Research invocation rules

One rule, uniform across all three types (POST, POLL, and DOCUMENT honor `withResearch`
identically — a topical poll or carousel benefits from fresh findings exactly as a post
does, and special-casing would fork the clean one-rule builder for no gain):

- **Runs** iff `withResearch === true` **and** `kind === INITIAL`.
- **Skipped on REFINE, always** — research is cache-seeded from the run record.
- **Re-runs on a whole-job retry of an INITIAL research run.** The builder still contains
  `RESEARCH` for `kind === INITIAL`, so a retry executes a fresh Tavily pass. This is
  precisely why R2 lands on terminal: the "retry is cheap because research is cached"
  premise holds only for REFINE.

---

## 7. The agent loop

Built in **two layers**, so swapping providers never touches the loop.

### Layer 1 — the LLM abstraction (`src/llm`), provider-swappable

Today's single `generateCompletion → string` grows into the single-turn primitives the loop
needs:

```ts
interface LLMStrategy {
  complete(messages: LLMMessage[], opts?: CompletionOptions): Promise<CompletionResult>;
  completeWithTools(messages: LLMMessage[], tools: ToolDefinition[], opts?: CompletionOptions)
    : Promise<ToolTurnResult>;                                          // ONE turn
  stream?(messages: LLMMessage[], opts?: CompletionOptions): AsyncIterable<string>;  // reserved
}

interface CompletionResult { text: string; usage: Usage }
interface ToolTurnResult   { text?: string; toolCalls: ToolCall[]; usage: Usage }
interface ToolDefinition   { name: string; description: string; parameters: ZodType }
interface ToolCall         { id: string; name: string; input: unknown }
interface Usage { promptTokens: number; completionTokens: number; totalTokens: number; cost: number }
```

The OpenRouter strategy implements these over `@openrouter/sdk` — its `tool()` Zod helper
for schema conversion, `chat.send` with `tools` for the single turn, and `usage.cost` /
`costDetails` for real per-call dollar cost. Add a typed `LLMError { retryable }`: the
`src/llm` layer owns retryable classification because it knows provider error semantics
(429/5xx/network → retryable; 4xx/auth → terminal).

We deliberately do **not** adopt the SDK's `callModel` orchestrator, which ships an
automatic multi-turn tool loop — burying the loop inside the vendor SDK defeats the
provider-swappability the layering exists for. We lean on its lower-level per-turn helpers
and own the loop.

### Layer 2 — `AgentRunner`, provider-agnostic

```ts
interface Tool<I = unknown, O = unknown> {
  name: string; description: string;
  parameters: ZodType<I>;
  execute: (input: I) => Promise<O>;
}

interface AgentRunConfig { system: string; messages: LLMMessage[]; tools: Tool[]; maxSteps: number; model?: string }
interface AgentStep      { toolCalls: ToolCall[]; toolResults: unknown[]; usage: Usage }
interface AgentRunResult { text: string; steps: AgentStep[]; usage: Usage }
interface AgentHooks     { onUsage?: (u: Usage) => void; onToolCall?: (t: { name: string }) => void }

run(config: AgentRunConfig, hooks?: AgentHooks): Promise<AgentRunResult>;
```

**The loop:** append seed messages → `completeWithTools` → if `toolCalls` is empty, return
`text`; else execute the called tools **in parallel within a turn** (`Promise.all`), append
their outputs as `role: 'tool'` messages, increment the step counter, repeat.

**Cap behavior — graceful finalization.** When `maxSteps` is reached but the model still
wants tools, make **one final completion with the tools removed** ("budget spent, answer
now"). This guarantees usable `text` instead of a dangling tool call and bounds worst-case
spend at `maxSteps + 1` LLM calls. A hard throw on cap would turn "the model was being
thorough" into a failed run that the engine would then retry into the same cap.

### Public surface

```ts
interface AgentRunner {
  research(input: ResearchInput): Promise<ResearchResult>;   // agentic
  generate(input: GenerateInput): Promise<ArtifactContent>;  // single structured completion
}

interface ResearchInput { prompt: string; type: ArtifactType; stylePreset?: StylePreset }
interface GenerateInput {
  type: ArtifactType; prompt: string;
  stylePreset?: StylePreset;   // voice — R4
  theme?: CarouselTheme;       // look  — R4, DOCUMENT only
  research?: ResearchResult;
  refine?: { priorContent: ArtifactContent; feedback: string };
}
```

**Generation is not a loop.** `generate()` has all its inputs already; it emits typed
`ArtifactContent` via Layer 1's `complete` (no tools), validated by
`ResponseParserService.parseWithSchema` against the §4 union, with one inline repair retry
re-prompting with the validation error. Prompt selection per type and per revision is
`AgentRunner`'s internal concern.

### The research agent

- **One tool, `searchWeb` (Tavily).** `{ query: string }` → `{ results: {title,url,content,score}[] }`,
  `searchDepth: 'advanced'`, `maxResults: 5`. On failure it returns `{ error }` and never
  throws — the loop absorbs it and the model adapts.
- **Fully autonomous.** No `ask_clarification` — there is nowhere to deliver a question in
  the async fire-and-forget model. The agent **self-directs its own search queries** across
  turns. This replaces today's `generateSearchKeywords` + `searchWithFallbacks` pre-steps;
  there is no separate keyword-generation stage.
- **`maxSteps = 5`**, config-driven via `RESEARCH_MAX_STEPS`.

```ts
interface ResearchSource { title: string; url: string }
interface ResearchResult { findings: string; sources: ResearchSource[] }
```

`findings = result.text` (the agent's own synthesis after searching);
`sources = dedupeByUrl(...)` across every `searchWeb` result. **Raw search bodies are not
forwarded** — `GENERATE` gets the distilled findings, not a dump of five 5-result payloads,
keeping the generation prompt tight. Stored verbatim on `researchContext`, so refine reuses
it with zero re-search.

### Usage accounting

`AgentRunner` must **not** hold the meter. The seam is a per-turn hook the step bridges to
`ctx.meter`:

- The loop invokes `hooks.onUsage(usage)` after **each** LLM turn and
  `hooks.onToolCall({ name })` when a tool fires.
- The step wires those to `ctx.meter.record(...)`: each LLM turn →
  `{ kind: 'llm', amount: usage.cost, detail: { model, totalTokens } }`; each web search →
  `{ kind: 'web_search', amount: 1 }`.

`AgentRunner` emits raw signals; §9 owns converting them to credits. Live per-turn emission
is what lets the SSE stream show a climbing credit count during a long research run.

### Scope

**OpenRouter-only for v1.** The `LLMProvider` enum keeps its unimplemented `OPENAI` /
`CLAUDE` arms; the layering makes adding a real strategy later an addition, not a loop
change. Per-role model config via `ConfigService`: `RESEARCH_MODEL` (fast, tool-loop turns)
and `GENERATION_MODEL` (stronger, final content) — retiring the scattered hardcoded model
literals. **Token streaming is deferred**; `stream()` stays an optional, unimplemented
method on the strategy interface. Live progress comes entirely from step events plus
`usage.tick`, which is enough for a "researching… generating…" UI with a running credit
count, without token-level plumbing.

---

## 8. The carousel template system

A carousel is a LinkedIn **document post**: a multi-page PDF, one page per slide, on the
1080×1350 portrait canvas. (LinkedIn's `content.carousel` is a *different*, sponsored-only
ad format and is unavailable to us for organic posting.)

### Template model — theme (deck) × slide type (role)

```ts
type CarouselTheme = 'bold' | 'minimal' | 'editorial' | 'gradient';   // R4
type SlideType     = 'cover' | 'content' | 'list' | 'quote' | 'cta';

Slide = { type: SlideType; fields: <type-specific, Zod-validated> };
```

**Theme is document-level, not per-slide** — a carousel's whole point is a consistent brand
look across pages. **`type` is per-slide** — real carousels are not homogeneous; a cover
(hook), body slides, and a CTA are visually distinct roles. **Field schemas attach to the
slide type, not the theme**: every theme renders the same five typed shapes and differs only
in how they look. That is what lets one Zod contract serve the artifact content union, the
agent's generation contract, and all four themes simultaneously.

### Field schema

```ts
const cap = (n: number) => z.string().trim().min(1).max(n);

export const slideFieldSchemas = {
  cover:   z.object({ eyebrow: cap(24).optional(), title: cap(70), subtitle: cap(120).optional() }),
  content: z.object({ heading: cap(60), body: cap(280) }),
  list:    z.object({ heading: cap(60), items: z.array(cap(80)).min(2).max(6) }),
  quote:   z.object({ quote: cap(200), attribution: cap(48).optional() }),
  cta:     z.object({ headline: cap(70), action: cap(40), handle: cap(40).optional() }),
} as const;

export const slideSchema  = z.discriminatedUnion('type', [ /* one arm per SlideType */ ]);
export const slidesSchema = z.array(slideSchema).min(2).max(15);
```

**Caps are the fit contract, sized to the tightest theme.** A fixed 1080×1350 slide has no
scroll, so overflow is the enemy. Character count is only a *proxy* for rendered width, so
the caps are enforced three ways, defence in depth: the agent prompt states them so the
model aims within them; Zod rejects over-cap output at the generation boundary; and the
`.slide` frame's `overflow: hidden` + `overflow-wrap: anywhere` is the last-resort clamp, so
a slip degrades to clipped text rather than a broken layout or a spilled page.

**The fixture deck is the fit proof.** Each theme ships a 15-slide `fixture.json` exercising
every slide type at maximum field lengths (6-item list, full-cap strings, an emoji, a long
unbroken token). A registry spec asserts it assembles cleanly; rendering the fixtures to PDF
is the manual QA gate per theme before launch. Caps are only trustworthy because the
fixtures prove them.

Launch is **text-only** — no user-supplied slide images. `slideSchema` is a discriminated
union precisely so a future `image` arm touches no existing one.

### Pagination — the one-slide-one-page invariant

The whole deck is **one HTML document rendered in one `htmlToPdf` call**. Puppeteer
paginates it; the CSS must make that pagination exact:

```css
.slide {
  box-sizing: border-box;   /* theme padding never inflates the box */
  width: 1080px; height: 1350px;
  overflow: hidden;         /* nothing ever spills onto the next page */
  overflow-wrap: anywhere;  /* one long token can't blow the box sideways */
  break-after: page;
  break-inside: avoid;
}
.slide:last-child { break-after: auto; }   /* load-bearing: no blank trailing page */
```

The `:last-child` override is not cosmetic — a break after the final slide emits an empty
page LinkedIn would show as a blank last card. `htmlToPdf` already passes
`width: '1080px', height: '1350px'`, zero margins, `printBackground: true`, and a matching
viewport, so the page box matches the slide box exactly and `pageCount = slides.length` is
true by construction.

### Self-contained HTML

Browserless renders the POSTed HTML with no reliable access to our asset host, so the
assembled document must resolve **zero network requests**. All CSS inlined in one `<style>`;
system font stacks by default (a brand font would be a subset WOFF2 `data:` URI); decoration
is CSS or inline SVG. With nothing to fetch, the util's `waitUntil: 'networkidle0'` resolves
immediately.

**Emoji caveat:** whether emoji render depends on the Browserless image shipping a color
emoji font (Noto Color Emoji is standard but unverified). The fixture deck includes an emoji
sample. If it renders as tofu, the generation prompt bans emoji rather than embedding a
multi-megabyte font.

### Security — LLM fields never become markup

Every slide field is LLM-generated, i.e. untrusted text flowing into HTML.

- **Double-stache `{{field}}` only**, and **only in element text content** — never in
  attributes, URLs, `<style>`, or comments, where HTML-escaping is not a sufficient defence.
  Lists use `{{#each items}}`.
- **Triple-stache `{{{…}}}` is banned and machine-enforced**: the registry's boot-time
  compile fails on any template source containing `{{{`, turning the rule from a review
  checkpoint into an invariant that cannot erode as templates are added. No custom helpers
  emitting `SafeString`s either.
- Rendering is sandboxed anyway — Browserless paints a PDF from an inert document with no
  cookies, no same-origin secrets, no navigation. Escaping is defence in depth, not the only
  wall.

### Rendering pipeline

At **module init**, the registry loads and `Handlebars.compile`s every `(theme, slideType)`
template once and **fails fast** if any file is missing, fails to compile, or contains
`{{{`. Per render, `CarouselRendererService`:

1. `assembleHtml(templateId, slides)` — pure, no I/O: apply each precompiled template to
   `slide.fields`, wrap in `<section class="slide slide--{{type}}">`, concatenate in order
   inside one document whose `<head>` inlines `base.css` + the theme's `theme.css`.
2. `htmlToPdf(html)` → `Buffer`.
3. `uploadFile('artifacts/${artifactId}/${version}/document.pdf', buffer, 'application/pdf')`.
4. Return `{ pdfKey, pageCount: slides.length }`.

Assembly is pure string-in/string-out, so it unit-tests without Browserless.

### Storage — store the key, sign on read (R1)

The R2 key is `artifacts/${artifactId}/${version}/document.pdf` — **version-scoped**, so a
refine renders to a fresh key and never clobbers a prior version's PDF, and a whole-job
retry PUTs the same key (idempotent, no orphans). The bucket is private, so the version
stores the **key**; client reads exchange it for a signed URL at response time and publish
fetches the buffer via `getFile(key)`. The rendered PDF *is* the document's preview — no
separate thumbnail asset for launch.

### Layout

```
assets/carousel/
  base.css
  templates/{bold,minimal,editorial,gradient}/
    cover.hbs content.hbs list.hbs quote.hbs cta.hbs theme.css fixture.json

src/carousel/
  index.ts  carousel.module.ts
  carousel-renderer.service.ts   carousel-renderer.service.spec.ts
  templates.ts     # registry + boot-time compile/validation
  schemas.ts       # slideFieldSchemas / slideSchema / slidesSchema — single source of truth
  utils/index.ts  utils/html-to-pdf.util.ts   # moved from src/mark, kebab-cased
```

`schemas.ts` is consumed by both the artifact content union (§4) and the agent's `generate()`
validation. The registry deliberately does **not** carry schemas — keying them by theme would
invite per-theme divergence of a contract that must stay uniform. Adding a theme later is a
new folder plus one registry entry; no schema or engine change.

---

## 9. Credits

### Denomination — a cost-backed unit

```
1 credit = $0.001 of raw provider cost   →   CREDITS_PER_USD = 1000
credits  = ceil(amount_usd * CREDITS_PER_USD * CREDIT_MARKUP)
```

`CREDITS_PER_USD` and `CREDIT_MARKUP` (default `1.0`) are **global** env, never per-tier.
Per-tier config carries only the allowance.

Because `amount_usd` is OpenRouter's authoritative per-call `usage.cost` — which already
prices each model's input and output tokens at that model's real rate — the credit price of
a call is **automatically correct per model and self-updating** when OpenRouter changes
prices. A raw token count would be price-blind: 1000 tokens of a frontier model and 1000 of
a cheap one cost the operator wildly different amounts yet would debit the same budget, and
it would need a hand-maintained per-model table that drifts every time provider prices move.
`usage.cost` already encodes all of that. Margin lives in two tunable levers —
`CREDIT_MARKUP` and the Paddle price of an allowance — so pricing can move without a code
change.

**Fallback (only when cost is missing).** If a provider returns `usage.cost` as
`0`/`undefined`, fall back to `ceil(totalTokens / 1000 * FALLBACK_CREDITS_PER_1K_TOKENS)`
and **log a warning**. For OpenRouter v1 `cost` is always present, so this should never
fire; it exists so a future provider without cost reporting cannot slip through free.
Tokens are carried on `detail.totalTokens` for display and audit, never for pricing.

### Surcharges

Web search and PDF render cost real money but emit no `usage.cost`. Each carries a flat
credit surcharge, priced in the same unit so it is commensurable with LLM credits:

| `UsageKind` | Fired by | Env constant | Illustrative |
|---|---|---|---|
| `llm` | every LLM turn | — (cost-derived) | — |
| `web_search` | research agent, per Tavily call | `CREDIT_SURCHARGE_WEB_SEARCH` | `8` |
| `pdf_render` | `RENDER_PDF`, per render (R5) | `CREDIT_SURCHARGE_PDF_RENDER` | `5` |

`record`'s `amount` is **polymorphic by `kind`** — USD for `llm`, a unit count for
surcharges (`credits = amount * CREDIT_SURCHARGE_<KIND>`). This asymmetry is inherited from
the committed `record({ kind, amount })` shape; it is pinned in one conversion table rather
than reshaping the upstream signal. A surcharge as a *percentage* of the run's LLM credits
was rejected: a web search's cost is fixed and independent of how expensive the generation
model is.

### `CreditMeterService`

```ts
interface CreditMeter {                                    // engine-composed, §5
  assertBalance(userId: string): Promise<void>;
  record(usage: { kind: UsageKind; amount: number; detail?: unknown }): void;
  commit(runId: string): Promise<void>;
}

@Injectable()
class CreditMeterService {                                 // stateless half
  toCredits(usage: { kind: UsageKind; amount: number }): number;  // pure, sync
  assertBalance(userId: string): Promise<void>;
  debit(userId: string, credits: number): Promise<void>;
}
```

**Split of ownership.** The engine owns the *stateful, per-run* half: the attempt-scoped
`creditsUsed` accumulator on `WorkflowRun`, the per-attempt reset, and `usage.tick`
emission. `CreditMeterService` owns the *stateless* half. `record` calls `toCredits(...)`,
adds to the accumulator, and emits `usage.tick` with the credit delta plus running total.
`commit(runId)` reads the winning attempt's `creditsUsed` and calls `debit(...)` — the only
real write to the period aggregate. `toCredits` is pure and synchronous (config in, integer
out), which keeps `record` non-async and makes it trivially unit-testable.

`CreditMeterService` **depends on** `FeatureGatingService` for tier/period/`Usage`
primitives and adds conversion on top. Putting the accumulator in `CreditMeterService` was
rejected: it is per-run state the engine already owns and resets, and duplicating it invites
double-count.

### Schema changes

**`FeatureKey` — rename, don't add.** `mark_tokens` → `credits`; it is already a variable
per-period consumption meter, so this re-denominates and re-scopes it rather than inventing
a sibling. `ai_drafts` is **removed**.

```ts
export const FEATURE_KEYS = {
  CREDITS: 'credits',                        // was mark_tokens
  CONNECTED_ACCOUNTS: 'connected_accounts',  // capacity counter — unchanged
  SCHEDULED_POSTS: 'scheduled_posts',        // capacity counter — unchanged
} as const;

type Feature = 'credits' | 'connected_accounts' | 'scheduled_posts';   // Tier.limits
```

`limits.credits` is the per-period allowance: positive integer, `-1` = unlimited
(short-circuits the guard), `0` = **AI disabled on this plan**. `Usage` is unchanged —
consumption keyed `(user_id, 'credits', periodStart)`, same unique index, same `$inc` upsert
+ E11000-retry write path. **Period resolution is reused verbatim** (subscription
`currentPeriodStart`, or UTC-month start). Credits reset each period; **no rollover** in v1.

**No new ledger collection.** The per-run breakdown lives on `WorkflowRun.creditsUsed` plus
the recorded ticks; the period total lives on `Usage`. That covers dashboard, SSE, and audit
without a third store.

### Enforcement — three touch points

1. **HTTP pre-check.** `POST /artifacts` and `/refine` call `assertBalance(userId)` before
   enqueueing, so an out-of-credits user gets an immediate `FeatureGateForbiddenException`
   (403, code `FEATURE_LIMIT_EXCEEDED`, feature `credits`) instead of a queued run that
   fails. Same exception shape the frontend already handles.
2. **Worker pre-run guard.** The engine calls `ctx.meter.assertBalance(userId)` before the
   step loop. Insufficient → **terminal** `WorkflowError` → run/version `FAILED`, reason
   `"insufficient credits"`. Guards the race where balance drained between enqueue and
   pickup.
3. **Post-run debit.** On `run.completed`, `commit(runId)` debits the winning attempt.
   Failed and retried attempts debit **nothing** — the operator absorbs transient-failure
   spend. Settlement is **best-effort** (try/catch + log): never fail a user's *completed*
   run over an accounting write.

**Balance semantics — headroom check, not fit check.** `assertBalance` passes iff
`used < limit` (or `limit === -1`). It does not verify the whole run will fit, because
commit-on-success has no pre-run estimate to fit against. A user with 5 credits left may
start a run that settles at 60 and overshoot; the **next** run's guard blocks. Bounded
overshoot is accepted and intentional — the agent's `maxSteps` cap bounds a single run's
worst case. **No mid-run cutoff in v1**; the live `creditsUsed` accumulator leaves room for
one without new plumbing.

**Refine runs** reuse cached research → no `web_search` surcharge, only the generation LLM
call (plus `pdf_render` for DOCUMENT). Metered and gated identically; just cheaper.

### Fate of the existing counters

| Current feature | Fate | Why |
|---|---|---|
| `mark_tokens` | → **`credits`** (renamed, re-denominated) | already the per-period consumption meter |
| `ai_drafts` | **retired** | every generation run debits credits; a separate draft counter is redundant double-gating |
| `scheduled_posts` | **unchanged counter** | scheduling is a plan *capacity* limit, not compute |
| `connected_accounts` | **unchanged counter** | account capacity, not consumption |

There is no coexistence window for `ai_drafts`: the clean write-over deletes the draft path
that gated it, so the counter has no remaining caller. `getDashboardUsage` returns `credits`
(used/limit/remaining, `-1` for unlimited) alongside the two counters; the `ai_drafts` and
`mark_tokens` keys are dropped.

### Paddle / tier config

Each plan's Paddle price maps to a tier carrying `limits.credits`, seeded from *target model
cost per average run × expected runs per month × `CREDIT_MARKUP`*. Illustrative ladder: free
`0` (no AI) or a small trial grant, Starter `2000`, Pro `10000`, top tier `-1`.

**Sizing anchor** (illustrative, at `CREDITS_PER_USD = 1000`, markup `1.0`): an insight post
≈ research (~$0.02) + generation (~$0.01) + one web search (`8`) ≈ **~38 credits**; a quick
post (no research) ≈ **~12 credits**; a carousel adds a `pdf_render` (`5`). So "2,000
credits" ≈ 50 insight posts or ~160 quick posts.

**Upgrades take effect immediately** — the allowance is read live from the resolved tier at
guard time while the `Usage` aggregate persists, so a mid-period upgrade instantly raises
headroom without touching usage rows. Downgrade lowers the ceiling the same way; a user
already over the new ceiling is blocked until the next period, with no clawback. Reset
cadence is the existing usage period, reused verbatim.

---

## 10. Post and publish

### Creating a post

```
POST /posts   { artifactId, version?, connectedAccount, scheduledAt? }
```

1. **Resolve and authorize** — load the artifact owner-scoped (403 if not the caller's);
   resolve `version` (defaults to `currentVersion`); resolve the account via the existing
   `getOwnedUsableLinkedinConnectedAccount(userId, accountId, action)`.
2. **Validate publishability** — the pinned version must be `READY` (cannot post
   `GENERATING` or `FAILED`); the composition must be valid for LinkedIn (trivially so for
   a single artifact — this is the seam where a future text+image pair is checked against
   the mutual-exclusivity rule); org accounts keep the existing `assertCompanyPagesAccess`
   gate.
3. **Branch on `scheduledAt`** — absent → run `publishPost` inline and persist `PUBLISHED`
   (+ `channelPostId`, `publishedAt`) or `FAILED` (+ `failureReason`). Present → assert the
   `scheduled_posts` counter on first-time schedule, persist `SCHEDULED`, enqueue the job,
   increment the counter.

### Publish composition

`publishPost(postId)` is **one routine**, invoked inline for immediate publish and by the
`post-schedule` worker at fire time.

**Reused verbatim** from today's `publishOnLinkedIn`: the `POST {LINKEDIN_API_BASE}/posts`
call with the `LinkedIn-Version: 202601` / `X-Restli-Protocol-Version: 2.0.0` / `Bearer`
header trio (202601 is confirmed valid for posts, polls, *and* documents);
`resolveLinkedinAuthorUrn`; the `visibility` / `distribution` / `lifecycleState` /
`isReshareDisabledByAuthor` envelope; `commentary` via `formatLinkedinContent`;
`x-restli-id` capture into `channelPostId`; connected-account decryption and the
`"Organization permissions must be used"` → reconnect error mapping. `ScheduleQueue` and the
`post-schedule` queue are unchanged, now keyed on `Post._id`.

**Rebuilt** — content composition reads the pinned artifact version, not `post.content` /
`post.media[]`:

| Artifact `type` | `commentary` | `content` object | Asset upload at publish |
|---|---|---|---|
| **POST** | the text | *(none)* | none |
| **POLL** | optional | `content.poll = { question, options[], settings: { duration, voteSelectionType: 'SINGLE_VOTE', isVoterVisibleToAuthor: true } }` | **none** — inline JSON |
| **DOCUMENT** | optional | `content.media = { id: <documentUrn>, title }` | **yes** — R2 `pdfKey` → LinkedIn |

- **`IContent` gains a `poll` arm.** The document rides in the existing `media.id` with a
  `urn:li:document:*` id — no new `IContent` field.
- **Duration mapping:** `durationDays: 1|3|7|14` → `ONE_DAY|THREE_DAYS|SEVEN_DAYS|FOURTEEN_DAYS`.
  `voteSelectionType` fixed `SINGLE_VOTE` (`MULTIPLE_VOTE` is documented as future);
  `isVoterVisibleToAuthor` fixed `true` (`false` returns 400).
- **Document upload** happens at publish time from the already-rendered PDF. New
  `uploadDocument` on `LinkedinMediaService`, modeled on `uploadImage`, **not**
  `uploadVideo`: `POST /rest/documents?action=initializeUpload` → **single PUT** of the
  bytes → the returned `value.document` URN. No chunking, no per-chunk ETags, no
  `finalizeUpload` step (documents explicitly do not support `SYNCHRONOUS_UPLOAD` either).
  Defensively poll `GET /rest/documents/{urn}` to `AVAILABLE` before attaching, mirroring
  `waitForVideoAvailable` — the docs show upload immediately followed by post creation and
  never state a mandatory wait, so this is unconfirmed and we wait to be safe. Enforce
  ≤100 MB / ≤300 pages before upload.

**Immediate-publish latency:** a DOCUMENT immediate-publish does init→PUT→poll inline, so
the HTTP call blocks on the LinkedIn upload. Acceptable for a one-shot PUT; if it proves
slow, route immediate publish through the schedule queue with `delay: 0` — same
`publishPost`, and the seam is already there.

### Retired for v1, preserved as the future-image seed

The **post-level embedded-media user-upload path** — `addLinkedinMedia`, the presigned
`initiate`/`complete` direct-to-R2 flow, and the `media-upload` queue that patched
`PostDraft.media.$` — goes dormant. Artifact content is produced by *generation* (documents
pre-rendered to R2), so a post never uploads user media in v1.
`LinkedinMediaService`'s **LinkedIn-upload half** (`uploadImage`, new `uploadDocument`,
`waitFor*Available`, R2 `getFile`) is reused by `publishPost`; its **user-upload half**
stays for the future image artifact type.

### Cancel / reschedule / retry

- **`DELETE /posts/:id`** — cancels a `SCHEDULED` post: `getJob(postId)` → `remove()`, then
  delete the record. Does **not** touch the source artifact.
- **`POST /posts/:id/schedule { scheduledAt }`** — reschedule a `SCHEDULED`/`FAILED` post
  (remove old job, add new). First-ever schedule counts against `scheduled_posts`; a
  reschedule of an already-counted post does **not** re-charge.
- **`POST /posts/:id/publish`** — publish immediately; enables one-click retry of a `FAILED`
  post.

### Compat-audit residue

The data-migration hazards (in-flight jobs, stranded media, orphaned R2 objects,
aggregations, backfill) are **moot** under the clean write-over: drop `postdrafts`, flush
Redis and R2 at cutover. The *engineering* residue is real and must be done:

- **`@InjectModel('PostDraft')` string token** in `auth.service.ts:76` → `Post`. Register
  `{ name: Post.name, schema: PostSchema }` in `database.module`. This fails loud at boot if
  missed.
- **Legacy `type` field** (a workflow-name string, `quickPostLinkedin`/`insightPostLinkedin`):
  dropped, no successor on `Post` — the artifact carries `type`. `getPosts`/metrics no longer
  aggregate on it.
- **Usage triggers:** `scheduled_posts` stays a capacity counter, asserted and incremented on
  first-time schedule, **monotonic** (delete/cancel/disconnect do not refund — an explicit
  carry-over of today's behavior). Immediate publish is not counted. `ai_drafts` is retired.
- **Account-disconnect safety:** repoint `auth.service`'s query from `postdrafts
  status:'SCHEDULED'` to `posts status:'SCHEDULED'` for the disconnected account; for each,
  `getJob(post._id).remove()` and set the post `FAILED`, reason `"connected account
  disconnected"`. There is no `DRAFT` to reset to, and the source artifact is untouched in
  the library, so the user re-posts it after reconnecting. **Add a regression test for
  disconnect → schedule-job cancel** — the audit called this out explicitly.

### HTTP surface

| Method | Route | Body / Query | Result |
|---|---|---|---|
| POST | `/posts` | `{artifactId, version?, connectedAccount, scheduledAt?}` | `201 Post` |
| POST | `/posts/:id/publish` | — | publish now / retry a FAILED post |
| POST | `/posts/:id/schedule` | `{scheduledAt}` | reschedule |
| DELETE | `/posts/:id` | — | cancel a SCHEDULED post + remove job |
| GET | `/posts` | `?status&month&connectedAccount&page` | list + `filters` |
| GET | `/posts/:id` | — | one post, with resolved artifact refs |
| GET | `/posts/metrics/:connectedAccountId` | — | `{ total, monthly[] }` |
| GET | `/posts/linkedin/image/:urn` | — | LinkedIn image proxy, reused unchanged |

---

## 11. SSE progress streaming

**`GET /runs/:runId/events`** — one stream per generation run.

Keyed by `runId`, not artifact: the kickoff responses already hand the client a `runId`,
which is the `WorkflowRun._id` *and* the Redis stream key, so it is the natural minimal
handle. A run belongs to exactly one artifact/version, so nothing is lost.

**Auth:** `@UseGuards(ClerkAuthGuard)`. Browser `EventSource` can send **only cookies**, no
custom headers — and the guard is already cookie-first (`__session`, with a legacy
`access_token` JWT fallback), so it works unchanged. Load the `WorkflowRun` by `:runId`;
**403** if `run.user !== req.user._id`, **404** if no such run. Do this *before* opening the
stream, so auth and ownership failures are ordinary JSON HTTP errors rather than mid-stream
events.

**Handler style: raw `@Res({ passthrough: false })`, not `@Sse()`.** The endpoint needs four
things that fight the `@Sse()` Observable abstraction: read the inbound `Last-Event-ID`
header to seek the replay cursor; short-circuit with **HTTP 204** before any stream body;
set anti-buffering headers per-response; and drive an imperative `XREAD BLOCK` loop whose
cadence also produces heartbeats. `@Sse()` owns the status line and content-type before we
can inspect `Last-Event-ID` or return 204, and hides the `res` we need.

WebSocket was rejected: progress is server→client, one-way, per-run, short-lived. SSE gives
native auto-reconnect and `Last-Event-ID` replay for free over plain HTTP and cookies.

### Wire format

```
id: <redis-stream-entry-id>
event: <RunEventType>            # e.g. step.completed
data: <JSON of { seq, ts, ...data }>   # single line
```

`event:` is the engine's `RunEventType` **verbatim** — the internal names *are* the client's
event names, so there is no translation layer to drift. Clients attach typed listeners
rather than switching inside one `onmessage`.

**`id:` is the Redis Stream entry ID, not `seq`.** This makes replay a trivial native
`XREAD ... STREAMS <key> <lastEventId>` with no `seq → offset` index to maintain. `seq`
still travels inside `data` as the app-level monotonic counter, so the client can detect
gaps and dedupe independently of the opaque transport id.

On connect, write `retry: 3000` to pin the reconnect backoff.

### Transport

One **Redis Stream** per run, `workflow:run:{runId}` (R6). For each open connection the
relay loops `XREAD BLOCK <heartbeatMs> COUNT <n> STREAMS workflow:run:{runId} <cursor>`.
This **single mechanism** gives replay, live tail, and heartbeat cadence at once: entries
returned → write them as SSE events; a block timeout with no entries → write a heartbeat and
loop. There is **no subscribe-race** — events fired before a late subscriber attaches are
simply still in the stream.

A blocking `XREAD` monopolizes its connection, so the relay uses
`RedisService.getClient().duplicate()` per SSE connection and **quits it on
`req.on('close')`**. Connection count is bounded by concurrent viewers of in-flight runs,
which is small: a user watches their own generation.

### Reconnect

| Situation | Behavior |
|---|---|
| No `Last-Event-ID` (fresh connect) | Replay the whole stream from `0`, then tail — a client that connects *after* `run.started` still renders full history |
| With `Last-Event-ID` | Resume strictly after that entry. No duplicates, no gap |
| Run terminal **and** client current | **HTTP 204** — per the SSE spec this tells `EventSource` to stop reconnecting, preventing a finished run from being polled forever by a stale tab |
| Run terminal, client behind | Open, replay the tail including the terminal event, close; the *next* reconnect hits the 204 |
| Stream expired, run doc present | Synthesize a snapshot from `WorkflowRun` (`status`, `currentStep`, `steps` reconstructed via `buildWorkflow(input)`), then close |
| Stream expired, run doc gone | `404` |

**Failures are data, not HTTP status.** Only pre-stream problems (auth, ownership, unknown
run) are HTTP errors. Once the stream is open, everything — including `run.failed` — is an
SSE event, so a mid-run failure never looks like a transport error to the client.

### Heartbeats, close, and the buffering gotchas

- Every `XREAD BLOCK` timeout with no entries writes an SSE **comment** `: hb\n\n`. Comments
  fire no event and carry no `id`, so they never perturb `Last-Event-ID`. Cadence **15 s**,
  comfortably under common 30–60 s proxy idle timeouts.
- **Initial frame:** immediately on open, before any replay, write `retry: 3000` and one
  heartbeat. The early write forces the response headers to flush past any buffering proxy,
  so the client's `onopen` fires promptly.
- **Close handshake:** after the terminal event, `res.end()`. The client calls `es.close()`
  in its `run.completed`/`run.failed` handler; the 204 short-circuit is the backstop. There
  is deliberately **no bespoke `end` event** — the two terminal events already are the
  end-of-stream signal.
- **Headers:** `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache,
  no-transform`, `Connection: keep-alive`, and **`X-Accel-Buffering: no`** — disabling nginx
  response buffering is the single most common fix for "SSE works locally, not in prod".
- **Disable gzip for this route.** Compression buffers the stream to build its window and
  would stall progress. Per §3, `main.ts:20`'s dead `/mark/chat` exclusion is **replaced**:

  ```ts
  filter: (req, res) => {
    if (req.path.includes('/runs/') && req.path.endsWith('/events')) return false;
    return compression.filter(req, res);
  }
  ```

### Retention

`XADD ... MAXLEN ~ 1000` bounds live size (a run emits well under 1000 events, so the cap is
a safety valve, not normal retention). On the terminal event, `EXPIRE workflow:run:{runId}
3600` reclaims the log after an hour — long enough for a client reconnecting shortly after
completion to replay the full run. No separate cleanup job; Redis self-manages. The
`WorkflowRun` Mongo doc persists independently.

### Client contract

```ts
type ProgressEvent =
  | { event: 'run.started';    data: { seq; ts; kind: 'INITIAL'|'REFINE'; type: 'POST'|'POLL'|'DOCUMENT'; steps: WorkflowStep[] } }
  | { event: 'step.started';   data: { seq; ts; step: WorkflowStep; index: number; total: number } }
  | { event: 'step.completed'; data: { seq; ts; step: WorkflowStep; index: number; total: number } }
  | { event: 'step.progress';  data: { seq; ts; step: WorkflowStep; [k: string]: unknown } }
  | { event: 'usage.tick';     data: { seq; ts; kind: UsageKind; credits: number; detail?: unknown } }
  | { event: 'step.failed';    data: { seq; ts; step: WorkflowStep; retryable: true; message: string } }
  | { event: 'run.completed';  data: { seq; ts; artifactId: string; version: number } }
  | { event: 'run.failed';     data: { seq; ts; failureReason: string } };
```

**"Artifact ready" is `run.completed`** — there is deliberately no separate `artifact.ready`
event. A run completing *is* the target version reaching `READY`, so `run.completed
{ artifactId, version }` is the single unambiguous "go look at it now" signal, on which the
client refetches `GET /artifacts/:id?version=<version>`.

**Progress-bar math** is `index/total` from the step events, where `total = steps.length`
from `run.started`. Because the builder emits an honest step list, `total` is exact.

**Exactly one terminal event fires per run.** `step.failed` (`retryable: true`) is *not*
terminal — it announces a transient blip while BullMQ retries the whole job, and the client
should show "retrying…", not "failed".

### Artifact library HTTP surface

All under `api/v1`, behind `ClerkAuthGuard`, owner-scoped.

| Method | Route | Body / Query | Result |
|---|---|---|---|
| POST | `/artifacts` | `{type, prompt, withResearch, stylePreset?, theme?}` | `202 {artifactId, runId}` |
| POST | `/artifacts/:id/refine` | `{feedback}` | `202 {artifactId, version, runId}` |
| PATCH | `/artifacts/:id` | partial content edit (head, `READY` only) | `200` |
| GET | `/artifacts` | `?type&status&month&page` | summaries + `filters {availableMonths, types}` |
| GET | `/artifacts/:id` | `?version=N` / `?includeVersions=true` | current version, or a specific one, or + version metadata |
| DELETE | `/artifacts/:id` | — | `200` soft delete |

**List returns lightweight summaries only** — `{id, type, title, status, updatedAt,
preview}`, never version arrays; `preview` is a commentary/first-slide snippet plus a signed
PDF URL for documents. Excludes soft-deleted, sorted `updatedAt` desc, paginated. The
`month` filter reuses the existing `%Y-%m` aggregation.

**Create is not hand-authoring** — it creates the `Artifact` (`currentVersion=1`, version 1
`GENERATING`), enqueues the run, and responds `202`. Synchronous create was rejected:
research + LLM + PDF render take tens of seconds and would hold the connection and bypass the
SSE design. **No `connectedAccount` at creation** — an artifact is account-agnostic until
posted.

**A version is one AI generation.** Manual edits do not create versions: `PATCH` mutates the
current version's content in place (allowed only when the head is `READY`) and stamps
`editedAt`. AI refine appends. Revert is deferred.

---

## 12. `src/mark` dissolution map

`src/mark` is 15 files / ~1156 lines and is **entirely dead code** today except for two
edges: `app.module.ts` imports `MarkModule` (lines 30, 56), and
`src/database/schemas/artifact.schema.ts` imports `postArtifact`/`pollArtifact` from
`src/mark/types/artifact.types.ts`. `searchWeb`, `html_to_pdf.util`, and `poll.util` have
**no callers anywhere** (the latter two are not even exported from `utils/index.ts`).

| File | Fate | Destination / note |
|---|---|---|
| `mark.module.ts` | **delete** | also remove `app.module.ts:30` and `:56` |
| `index.ts` | **delete** | |
| `artifact.service.ts` | **delete** | superseded by the new `ArtifactService` (§4, §11) |
| `artifact.service.spec.ts` | **delete** | |
| `types/artifact.types.ts` | **delete** | `postArtifact`/`pollArtifact`/`markArtifact` replaced by the §4 Zod union. Deleting this unblocks the last hard edge in `artifact.schema.ts` |
| `search.ts` | **move** | → `src/agent/tools/search-web.tool.ts`, wrapped as a `Tool` (§7). Keep the `{ error }`-on-failure contract — the loop depends on it never throwing |
| `utils/html_to_pdf.util.ts` | **move** | → `src/carousel/utils/html-to-pdf.util.ts` (kebab-case per repo convention). Defaults untouched — 1080×1350, zero margins, `printBackground` |
| `utils/html_to_pdf.util.spec.ts` | **move** | alongside |
| `utils/post.util.ts` | **salvage, then delete** | Extract `linkedInCharCount` → `src/artifact/utils/linkedin-char-count.util.ts`; it is the reference implementation for the §4 3000-char `commentary` cap (LinkedIn counts by UTF-16 code unit). The `validateLinkedInPost` validator/preview half has no caller — see the open question below |
| `utils/post.util.spec.ts` | **salvage, then delete** | keep the `linkedInCharCount` cases |
| `utils/poll.util.ts` | **absorb, then delete** | Its constraints (≤140 question, 2–4 options, ≤30 chars each, **options mutually unique**) become the §4 Zod poll schema. The uniqueness rule is the one thing #101/#102 missed — carry it forward |
| `utils/poll.util.spec.ts` | **absorb, then delete** | port cases into the artifact schema spec |
| `utils/html.utils.ts` | **delete** | `validateHtml`/`correctHtml`/`strictParseHtml` (parse5). Under §8 the AI never authors HTML — it fills fields — so these have no consumer |
| `utils/html.utils.spec.ts` | **delete** | |
| `utils/index.ts` | **delete** | |

**Dependency cleanup:** `parse5` (`^8.0.1`, a direct dependency) is used **only** by
`html.utils.ts`. Once that file is deleted, drop `parse5` from `package.json`.

**Open question for the operator** (does not block the build): does the frontend want
`validateLinkedInPost`'s hook-preview and hashtag/emoji warnings surfaced on the artifact
editor? If yes, it should be re-homed as a small `src/artifact/utils/linkedin-post-lint.util.ts`
and exposed on the artifact GET response. If no, delete it with the rest. Defaulting to
**delete** — nothing calls it today.

### What else dies with the write-over

| Target | Reason |
|---|---|
| `src/database/schemas/post-draft.schema.ts` (+ `PostDraftStatus`) | replaced by `Post` (§4) |
| `src/database/schemas/artifact.schema.ts` | rebuilt to §4; retires the `enum: ['html','text','structured']` / `ArtifactType` mismatch |
| `src/workflow/engine/*`, `workflow.registory.ts`, `workflow.types.ts` | rebuilt to §5 |
| `src/workflow/workflows/{quickPostLinkedin,insightPostLinkedin}.workflow.ts` | folded into the `withResearch` toggle |
| `src/workflow/steps/{createLinkedinDraft,extractIntent,getQueries}.step.ts` | replaced by the five §6 steps |
| `agent.service.ts`: `generateUserIntent`, `generateSearchKeywords`, `searchWithFallbacks`, `getYouTubeTranscripts`, `extractInsight`, `createDraft`, `createLinkedInPost`, `updateDraft` | folded into `research()` + `generate()` |
| `post.service.ts`: `createDraft`, `updateContent`, `addLinkedinMedia`, `initiate`/`completeMediaUpload`, embedded-`media` logic + DTOs | §10; `publishOnLinkedIn`→`publishPost`, `schedulePost`, `deletePost`, `getPosts`, `getPost`, `getPostMetrics` are kept and re-pointed |
| `FEATURE_KEYS.AI_DRAFTS`, `assertAiDraftQuota`, `incrementAiDraftUsage` | §9 |
| `main.ts:20` `/mark/chat` compression exclusion | dead route; replaced by the SSE exclusion (§11) |
| `GOOGLE_API_KEY` (YouTube Data API) | the heavy YouTube search→transcript→compress pipeline dies with the old engine. Confirm no other caller before removing the env key |

---

## 13. Configuration

New global env, added to `.env.example` (no hardcoded values — repo rule):

| Key | Purpose | Default |
|---|---|---|
| `CREDITS_PER_USD` | credit peg | `1000` |
| `CREDIT_MARKUP` | margin multiplier | `1.0` |
| `FALLBACK_CREDITS_PER_1K_TOKENS` | safety net when `usage.cost` is missing | — |
| `CREDIT_SURCHARGE_WEB_SEARCH` | flat surcharge per Tavily call | `8` |
| `CREDIT_SURCHARGE_PDF_RENDER` | flat surcharge per Browserless render | `5` |
| `RESEARCH_MODEL` | fast model for tool-loop turns | — |
| `GENERATION_MODEL` | stronger model for final content | — |
| `RESEARCH_MAX_STEPS` | agent iteration cap | `5` |

Already present, no action: `TAVILY_API_KEY`, `OPENROUTER_API_KEY`, `BROWSERLESS_URL`,
`BROWSERLESS_TOKEN`. Already absent, no action: all `MARK_*`.

---

## 14. Risks carried into the build

**LinkedIn API, unconfirmed from primary sources.** Three items want a one-shot sandbox
confirmation before the DOCUMENT and POLL paths are trusted in production:

1. **Community Management API product grant.** Polls and documents live under LinkedIn's
   Marketing / Community Management surface and are gated at the *app-product* level, not per
   endpoint. The app already posts images and videos through `/rest/posts` with
   `w_member_social` / `w_organization_social`, so access appears granted — but it is not
   verifiable from public docs. **Confirm the connected app's product grant explicitly
   includes Community Management before shipping polls/documents.**
2. **Must a document reach `AVAILABLE` before attaching to a post?** The docs show upload
   immediately followed by post creation and never state a mandatory wait; the video flow
   *does* require it. We poll defensively (§10), which is correct either way, but the poll
   adds latency to immediate publish. Verify and drop the wait if unnecessary.
3. **Mutual exclusivity of `content` sub-fields is an inference,** not a verbatim rule.
   Consistent across every documented example and the union-style schema, but LinkedIn never
   prints "you cannot combine these." Our publish composition enforces it regardless, so the
   risk is only that we are *more* restrictive than necessary.

Additionally: **`MULTIPLE_VOTE` polls are documented as future** — do not build UI depending
on multi-select. **Polls are organic and non-sponsored only** ("API partners can only create
non-sponsored poll posts") — confirmed, no workaround. **Organic `content.carousel` is
unavailable** — confirmed; the swipeable format must be a document post.

**Emoji rendering in Browserless** (§8) — unverified whether the image ships a color emoji
font. The fixture deck surfaces it; if it renders as tofu, the generation prompt bans emoji.

**Character caps are a proxy for rendered width** (§8). The three-layer defence (prompt, Zod,
`overflow: hidden`) means a miscalibration degrades to clipped text, never a broken layout —
but the per-theme fixture render is the only real proof, and it is a manual QA gate.

---

## 15. Implementation tickets

Ordered as **tracer-bullet vertical slices**: slice 0 is a walking skeleton that goes all the
way through, and each later slice widens it. Every slice is independently shippable and
leaves the tree green. `Blocked by` declares hard ordering.

### Slice 0 — walking skeleton: a research-off POST artifact, end to end

> **T1 — LLM layer: single-turn primitives + typed errors.**
> Extend `LLMStrategy` with `complete` / `completeWithTools` / reserved `stream`. Add
> `ToolDefinition`, `ToolCall`, `Usage`, and the assistant-with-tool-calls and `role:'tool'`
> message variants. Implement in the OpenRouter strategy over `@openrouter/sdk`'s `tool()` +
> `chat.send`, surfacing `usage.cost`. Add typed `LLMError { retryable }` (429/5xx/network →
> retryable; 4xx/auth → terminal). *Blocked by: none.*

> **T2 — `Artifact` schema + the POST arm of the content union.**
> New `Artifact`/`ArtifactVersion` schema (§4) with `ArtifactType`, `VersionStatus`,
> `CarouselTheme` (R4). Zod union with the POST arm only, including the 3000-char
> `commentary` cap via `linkedInCharCount` salvaged from `post.util.ts` (§12). Implement the
> `ArtifactWriter` role (`setVersionContent`, `readCurrent`). Rebuild
> `src/database/schemas/artifact.schema.ts`, deleting the enum/type mismatch and the
> `src/mark/types` import. *Blocked by: none.*

> **T3 — `CreditMeterService` + the `credits` feature key.**
> Rename `FEATURE_KEYS.MARK_TOKENS` → `CREDITS` and the `Feature` union arm; drop
> `AI_DRAFTS`, `assertAiDraftQuota`, `incrementAiDraftUsage`. `assertMarkTokenQuota` →
> `assertBalance` (headroom check); `incrementMarkTokenUsage` → `debit`. New
> `CreditMeterService` with pure `toCredits` (llm/cost path + token fallback + warn). Update
> `getDashboardUsage` to the `credits` shape. Config: `CREDITS_PER_USD`, `CREDIT_MARKUP`,
> `FALLBACK_CREDITS_PER_1K_TOKENS`. Tests per CLAUDE.md: `credit-meter.service.spec.ts` and
> an updated `feature-gating.service.spec.ts` (headroom guard, `-1`/`0` edges). *Blocked by:
> none.*

> **T4 — Workflow engine core + `WorkflowRun`.**
> New `WorkflowRun` schema. `WorkflowStep` enum redefined to the five §6 steps.
> `buildWorkflow`, typed `RunState`, patch-merging `runWorkflow` loop, `StepContext` with all
> six roles **including `renderer`** (R3). `RunEvent` envelope, core-assigned `seq`, emitter
> that **only** `XADD`s (R6) with `MAXLEN ~ 1000` and `EXPIRE` on terminal. `WorkflowError`
> taxonomy, `attempts: 3` + exponential backoff, `UnrecoverableError` for terminal, and the
> terminal-failure handler (version → `FAILED`, run → `FAILED`, emit `run.failed`, **no
> commit**). Attempt-scoped `creditsUsed` reset. Delete `src/workflow/engine/*`,
> `workflow.registory.ts`, and both legacy workflow definitions. *Blocked by: T2, T3.*

> **T5 — `AgentRunner.generate()` for POST + the two code steps.**
> `AgentRunner` surface; `generate()` as a single `complete` call validated against T2's Zod
> union with **one inline repair retry**, and a Zod failure surviving it thrown as
> **terminal** (R2). Per-type prompt for POST, with `resolveStylePresetInstruction` injecting
> voice (R4). Step handlers `RESOLVE_INPUT`, `GENERATE`, `PERSIST_VERSION`. Wire the worker's
> `workflow` queue to build `StepContext` from the role interfaces. Config: `GENERATION_MODEL`.
> *Blocked by: T1, T2, T4.*

> **T6 — `POST /artifacts` + `GET /runs/:runId/events`.**
> Create endpoint: `assertBalance` pre-check → create artifact + v1 `GENERATING` → enqueue →
> `202 {artifactId, runId}`. SSE controller with raw `@Res`, `ClerkAuthGuard`, owner scoping
> (403/404 before the stream opens), `XREAD BLOCK` relay on a duplicated ioredis connection,
> `Last-Event-ID` replay, 204 terminal short-circuit, 15 s heartbeats, `X-Accel-Buffering:
> no`, `retry: 3000`, teardown on `req.on('close')`. **Replace** the dead `/mark/chat`
> compression exclusion in `main.ts:20` with the SSE one (§3). *Blocked by: T4, T5.*

**Slice 0 exit criteria:** `POST /artifacts {type:'POST', withResearch:false}` returns 202;
the worker generates; the browser sees `run.started → step.started/completed ×3 →
usage.tick → run.completed`; the version is `READY`; credits are debited once.

### Slice 1 — research

> **T7 — the generic agent loop + the `searchWeb` tool + `RESEARCH`.**
> `Tool` interface, `AgentRunConfig`, the `while` loop over `completeWithTools` with parallel
> in-turn tool execution, `maxSteps` cap with **graceful finalization** (one final
> tools-removed completion). `AgentHooks` (`onUsage`, `onToolCall`). Move
> `src/mark/search.ts` → `src/agent/tools/search-web.tool.ts`, wrapped as a `Tool` preserving
> its never-throw `{ error }` contract. `research()` reducing `AgentRunResult` →
> `{ findings, sources }` with URL dedupe and **no raw bodies forwarded**. `RESEARCH` step:
> persists `researchContext` on the run, emits `step.progress { sourcesFound }`, bridges
> `onUsage`/`onToolCall` → `ctx.meter.record`. `web_search` surcharge in `toCredits`. Config:
> `RESEARCH_MODEL`, `RESEARCH_MAX_STEPS`, `CREDIT_SURCHARGE_WEB_SEARCH`. *Blocked by: T5.*

### Slice 2 — polls

> **T8 — POLL artifacts.**
> POLL arm of the Zod content union: question ≤140, 2–4 options ≤30 chars each, **mutually
> unique** (absorbed from `poll.util.ts`, §12), `durationDays ∈ {1,3,7,14}`. POLL branch in
> `generate()` + its prompt. No new steps — POLL is structurally identical to POST.
> *Blocked by: T7.*

### Slice 3 — carousels

> **T9 — carousel schemas, templates, and assets.**
> New `src/carousel/` module. `schemas.ts` (`slideFieldSchemas`, `slideSchema`,
> `slidesSchema` 2–15). `templates.ts` typed registry with **boot-time compile that fails
> fast** on a missing file, a compile error, or any `{{{`. `base.css` with the `.slide` frame
> and the load-bearing `:last-child { break-after: auto }`. Four themes × five slide types =
> 20 `.hbs` + 4 `theme.css` + 4 `fixture.json` (15 slides, max-length fields, an emoji, a long
> unbroken token). Registry spec iterating every fixture through `assembleHtml`. *Blocked by:
> none.*

> **T10 — `CarouselRendererService` + `RENDER_PDF`.**
> Move `html_to_pdf.util.ts` → `src/carousel/utils/html-to-pdf.util.ts` (kebab-case), defaults
> untouched. `assembleHtml` (pure) → `htmlToPdf` → `uploadFile` to
> `artifacts/${artifactId}/${version}/document.pdf`. Implement the `CarouselRenderer` role
> (R3). `RENDER_PDF` step writing `render = { pdfKey, pageCount }` (R1), emitting **no**
> `step.progress` (R7) and one `pdf_render` surcharge (R5). Browserless failure → retryable;
> unknown `templateId`/`slide.type` → terminal. Config: `CREDIT_SURCHARGE_PDF_RENDER`.
> *Blocked by: T4, T9.*

> **T11 — DOCUMENT artifacts end to end.**
> DOCUMENT arm of the Zod union (`templateId: CarouselTheme`, `slides`, `pdfKey?`,
> `pageCount?`). DOCUMENT branch in `generate()`, with `theme` **stamped authoritatively when
> user-supplied** and model-picked-then-Zod-validated when omitted (R4). Builder inserts
> `RENDER_PDF` for `type === DOCUMENT`. `PERSIST_VERSION` folds `pdfKey`/`pageCount` into
> `content.document`. **Manual QA gate:** render all four fixture decks to PDF and eyeball
> pagination, overflow, and emoji. *Blocked by: T8, T10.*

### Slice 4 — refine

> **T12 — REFINE runs.**
> `POST /artifacts/:id/refine {feedback}` → append a `GENERATING` version →
> `202 {artifactId, version, runId}`. `RunKind.REFINE`; builder omits `RESEARCH`.
> `RESOLVE_INPUT` seeds `refine = { priorContent, feedback }` and copies `research` from the
> artifact's latest `COMPLETED` `WorkflowRun.researchContext`. Revision prompt in `generate()`.
> DOCUMENT refine re-runs `RENDER_PDF` to the new version's key, carrying the theme forward.
> *Blocked by: T11.*

### Slice 5 — the library

> **T13 — artifact library API.**
> `GET /artifacts` (summaries only, `%Y-%m` month filter, `filters {availableMonths, types}`,
> excludes soft-deleted, paginated); `GET /artifacts/:id` (`?version=N`,
> `?includeVersions=true` → version metadata only); `PATCH /artifacts/:id` (mutates the READY
> head in place, stamps `editedAt`, no new version); `DELETE /artifacts/:id` (soft).
> **Signed-URL exchange** (`getSignedUrl(pdfKey)`) on every response carrying a document
> preview (R1). Owner-scoped throughout. *Blocked by: T11.*

### Slice 6 — publishing

> **T14 — `Post` schema + `publishPost` for POST artifacts.**
> New `Post`/`PostStatus` schema (§4), registered in `database.module`. `publishPost(postId)`
> resolving the pinned `{artifact, version}` → `ArtifactContent` → `IContent`, reusing the
> existing header trio, `resolveLinkedinAuthorUrn`, envelope, and `x-restli-id` capture.
> `POST /posts` with the immediate-publish branch and READY-version validation. **H2:** fix
> `@InjectModel('PostDraft')` in `auth.service.ts:76`. *Blocked by: T13.*

> **T15 — publish POLL and DOCUMENT.**
> `IContent` gains a `poll` arm; `durationDays` → LinkedIn duration enum;
> `voteSelectionType: 'SINGLE_VOTE'`, `isVoterVisibleToAuthor: true`. New
> `LinkedinMediaService.uploadDocument` — init → **single PUT** → `value.document` URN, **no
> chunking, no ETags, no finalize** — plus `waitForDocumentAvailable`. Enforce ≤100 MB /
> ≤300 pages. DOCUMENT publish sources bytes via `getFile(pdfKey)`. `MediaType` gains
> `DOCUMENT`. Spec per CLAUDE.md: `linkedin-media.service.spec.ts` for the single-PUT path.
> **Sandbox-verify the three §14 LinkedIn unknowns before merging.** *Blocked by: T14.*

> **T16 — scheduling, cancel, and disconnect safety.**
> `POST /posts/:id/schedule`, `POST /posts/:id/publish` (retry a FAILED post), `DELETE
> /posts/:id`. `scheduled_posts` asserted + incremented on first-time schedule only,
> monotonic. **H8:** repoint `auth.service`'s disconnect query to `posts status:'SCHEDULED'`,
> cancel jobs, set `FAILED` with `"connected account disconnected"`, leave the artifact
> untouched. **Add the disconnect → schedule-job-cancel regression test** the audit demanded.
> `GET /posts`, `GET /posts/:id` (resolving artifact refs), `GET /posts/metrics/:id`
> re-pointed. *Blocked by: T15.*

### Slice 7 — demolition and seed

> **T17 — dissolve `src/mark` and the legacy engine.**
> Execute the §12 table: delete `mark.module.ts` (and `app.module.ts:30,56`), `index.ts`,
> `artifact.service.ts`(+spec), `types/artifact.types.ts`, `html.utils.ts`(+spec),
> `utils/index.ts`, and the salvaged-from `post.util.ts` / `poll.util.ts`. Drop `parse5` from
> `package.json`. Delete `post-draft.schema.ts` + `PostDraftStatus`, the legacy step files,
> the dead `agent.service.ts` pipeline methods, and the `PostDraft`-coupled `post.service.ts`
> methods and DTOs. Confirm `GOOGLE_API_KEY` has no remaining caller before removing it.
> *Blocked by: T12, T13, T16.*

> **T18 — tier seed, `.env.example`, and the dashboard.**
> Seed `limits.credits` per tier (free `0` or a trial grant, Starter `2000`, Pro `10000`, top
> `-1`), sized against the §9 anchor. Add all eight §13 keys to `.env.example`. Verify
> `getDashboardUsage` returns `{credits, connected_accounts, scheduled_posts}` and that
> `limit === 0` is distinguishable from "out of credits". *Blocked by: T3, T17.*

### Not covered by these tickets

Client-side handoff documentation (how the frontend consumes SSE, the library API, and the
refine flow) — the contract is fixed in §11, but the frontend migration is a separate effort.
Rollout sequencing is trivial under the clean write-over: drop `postdrafts`, flush Redis and
R2, deploy. There is no coexistence window and no feature flag.
