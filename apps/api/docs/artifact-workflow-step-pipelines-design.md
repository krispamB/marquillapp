# Artifact Workflow Step Pipelines — Design

> Status: design spec for wayfinder map #99, ticket #109 (grilling outcome).
> Author: generated for Christopher Pam. Decisions settled on 2026-07-09.
> **Synthesis ticket.** It does not invent a new engine — #103 (engine/step model),
> #104 (agent loop), #108 (carousel render), #102 (artifact schema), and #101
> (LinkedIn API) already settled the parts. #109 stitches them into the **concrete
> per-workflow pipelines**: for each artifact `type` (POST / POLL / DOCUMENT) and
> each run `kind` (INITIAL / REFINE) — the ordered deterministic steps, which are AI
> vs. pure code, where the research agent runs (and when it's skipped), the
> refine-run variants, and each step's inputs/outputs through the run state.
>
> Blockers #101, #103, #104, #108 are all closed.

Feeds the final spec assembly (#110). Interlocking tickets are referenced inline at
each boundary.

## Framing (charter-derived givens)

- **One engine, one build flow** (#103). A single artifact-build pipeline serves every
  generation; it varies along three axes only: `type` (POST | POLL | DOCUMENT, #102),
  `withResearch` (the quick/insight collapse from #100), and `kind`
  (INITIAL | REFINE). There is no per-type or per-mode *separate* workflow — the
  variation is **composition**, not branching (#103 §1–2).
- **The engine fills a pre-created version, never creates artifacts** (#103, #102 §6).
  `POST /artifacts` (and `/refine`) create the `Artifact` + a `GENERATING` version
  first, respond `202 {artifactId, runId}`, then enqueue the run whose pipeline this
  doc defines.
- **Executes in the BullMQ worker** (charter #4); steps emit events the SSE stream
  (#107) relays. This doc fixes *what runs in what order and what each step reads/
  writes*; #103 owns the run record, retry taxonomy, and emission envelope.
- **What #109 owns vs. references.** #109 owns the concrete pipelines, the AI-vs-code
  classification, the per-step RunState I/O contract, the research skip rules, the
  refine variants, **and** the resolution of the one live cross-ticket conflict at
  `GENERATE` (§8). It references — does not redefine — the engine loop (#103), the
  agent surface (#104), the render step internals (#108), the content schemas (#102),
  and the LinkedIn constraints (#101).

The canonical flow (#103 §2), bracketed steps conditional:

```
RESOLVE_INPUT → [RESEARCH] → GENERATE → [RENDER_PDF] → PERSIST_VERSION
```

---

## 1. The builder produces an honest, per-combination step list

The concrete step list is assembled by the #103 §2 builder, reproduced here as the
spine every pipeline in §3 instantiates:

```ts
function buildWorkflow({ type, withResearch, kind }: BuildSpec): WorkflowDefinition {
  return {
    name: `artifact:${type}`,
    steps: [
      WorkflowStep.RESOLVE_INPUT,
      ...(withResearch && kind === RunKind.INITIAL ? [WorkflowStep.RESEARCH] : []),
      WorkflowStep.GENERATE,
      ...(type === ArtifactType.DOCUMENT ? [WorkflowStep.RENDER_PDF] : []),
      WorkflowStep.PERSIST_VERSION,
    ],
  };
}
```

- **The emitted sequence is honest** — only steps that actually run appear, because
  the sequence feeds the SSE progress stream and the progress-percentage math (#103
  §2, #107).
- **`RESEARCH` is gated on `withResearch && kind === INITIAL`** — the research axis is
  **uniform across all three types** (POST, POLL, DOCUMENT all honor `withResearch`
  identically; no per-type special-casing — see §4). REFINE never runs `RESEARCH`; it
  reuses cached findings (§5).
- **`RENDER_PDF` is gated on `type === DOCUMENT`** — the only type-dependent step. It
  runs on **both** INITIAL and REFINE document runs (a refine re-renders to the new
  version's key — §5, #108 §7).
- **`GENERATE` dispatches on `type` internally** — one step, three output shapes (§2).

So there are **nine `(type × kind × withResearch)` combinations** — the 3 × 2 × 2 = 12
axis product minus the 3 REFINE-with-research-on combos that cannot exist (REFINE never
takes the research axis; research is always cache-seeded, never re-run). Those nine
combinations collapse to just **four distinct step-list shapes** (the count that feeds
the progress stream — many combinations share a shape):

| # | type | kind | withResearch | Step list |
|---|---|---|---|---|
| 1 | POST | INITIAL | off | `RESOLVE_INPUT → GENERATE → PERSIST_VERSION` |
| 2 | POST | INITIAL | on | `RESOLVE_INPUT → RESEARCH → GENERATE → PERSIST_VERSION` |
| 3 | POST | REFINE | (n/a) | `RESOLVE_INPUT → GENERATE → PERSIST_VERSION` |
| 4 | POLL | INITIAL | off | `RESOLVE_INPUT → GENERATE → PERSIST_VERSION` |
| 5 | POLL | INITIAL | on | `RESOLVE_INPUT → RESEARCH → GENERATE → PERSIST_VERSION` |
| 6 | POLL | REFINE | (n/a) | `RESOLVE_INPUT → GENERATE → PERSIST_VERSION` |
| 7 | DOCUMENT | INITIAL | off | `RESOLVE_INPUT → GENERATE → RENDER_PDF → PERSIST_VERSION` |
| 8 | DOCUMENT | INITIAL | on | `RESOLVE_INPUT → RESEARCH → GENERATE → RENDER_PDF → PERSIST_VERSION` |
| 9 | DOCUMENT | REFINE | (n/a) | `RESOLVE_INPUT → GENERATE → RENDER_PDF → PERSIST_VERSION` (= #7 shape) |

The four distinct shapes: **A** `RESOLVE_INPUT → GENERATE → PERSIST_VERSION` (rows 1, 3,
4, 6); **B** = A + `RESEARCH` (rows 2, 5); **C** = A + `RENDER_PDF` (rows 7, 9);
**D** = A + `RESEARCH` + `RENDER_PDF` (row 8).

**POST and POLL share identical pipelines** — structurally the same step list; they
differ *only* in `GENERATE`'s output shape (commentary vs. commentary+poll object) and
in what `PERSIST_VERSION` Zod-validates. **DOCUMENT is POST/POLL + `RENDER_PDF`.** This
is the whole variation surface.

## 2. Step catalogue — the five steps

Each step below is fixed once and reused across all pipelines in §3. **AI** = calls the
LLM/agent (nondeterministic, metered); **code** = deterministic, no model call. Steps
**read the RunState slots they need** (guarding with a `WorkflowError` if a required
upstream slot is missing — #103 §3) and **write only their own slots** via a returned
`Partial<RunState>` patch.

### `RESOLVE_INPUT` — code

- **Purpose:** materialize the typed `RunState` from the job's `BuildInput`; on a
  refine, additionally seed the `refine` and `research` slots from durable state.
- **Reads:** `job.data: BuildInput` (`type, prompt, withResearch, stylePreset?,
  userId, artifactId, version, kind`). On **REFINE**: the artifact's prior
  `currentVersion.content` (via `ctx.artifacts.readCurrent`) and the artifact's latest
  `COMPLETED` `WorkflowRun.researchContext` (via `ctx.run` / a run lookup).
- **Writes:** `input` (always). On REFINE also `refine = { priorContent, feedback }`
  and `research` (copied from cache, if any) — #103 §11.
- **Emits:** nothing beyond the core `step.started/completed`.
- **Failure:** a missing target artifact/version is **terminal** (`retryable: false`) —
  #102 created them at kickoff, so absence is a bug, not a blip. Re-running can't fix it.

### `RESEARCH` — AI (agentic loop) — *conditional: `withResearch && kind === INITIAL`*

- **Purpose:** gather + synthesize web findings that inform `GENERATE`.
- **Reads:** `input` (`prompt, type, stylePreset`).
- **Calls:** `ctx.agent.research({ prompt, type, stylePreset })` → `ResearchResult
  { findings, sources }` (#104 §5–6). The agent runs the generic tool loop with the
  single `searchWeb` (Tavily) tool, `maxSteps = RESEARCH_MAX_STEPS` (default 5), and
  self-directs its own queries — there is no separate keyword-generation stage.
- **Writes:** `research` slot; **and persists `researchContext` on the `WorkflowRun`**
  (via `ctx.run`) so a later refine reuses it with zero re-search (#103 §4, §11).
- **Emits:** optional `step.progress` (e.g. `{ sourcesFound }`) via `ctx.emit`;
  `usage.tick` per LLM turn and per `searchWeb` call, both via `ctx.meter.record`
  (bridged from the agent's `onUsage` / `onToolCall` hooks — #104 §7).
- **Failure:** tool errors are absorbed in-loop (returned to the model as `{ error }`,
  #104 §8); an LLM transport error surfaces as `WorkflowError { retryable }` per
  `src/llm`'s classification (429/5xx/network → retryable; 4xx/auth → terminal).

### `GENERATE` — AI (single structured completion) — *always*

- **Purpose:** produce the typed `ArtifactContent` for the artifact's `type`, plus
  a 1–100 character library title on the initial run only.
- **Reads:** `input` (`type, prompt, stylePreset`), `research?` (cached or fresh),
  `refine?` (prior content + feedback).
- **Calls:** `ctx.agent.generate({ type, prompt, stylePreset, research?, refine? })`
  → `ArtifactContent`, a single `complete` call (no tools). The same concrete Zod
  object is converted to a strict OpenRouter JSON-Schema response format and then
  validated locally after completion. OpenRouter routing requires response-format
  support rather than allowing a provider to ignore the constraint. A local Zod
  failure still receives **one inline repair retry**, constrained and validated by
  that same schema (#104 §4, §8).
  Dispatch on `type`:
  - **POST** → `{ commentary }` (text is the whole artifact).
  - **POLL** → `{ commentary?, poll { question ≤140, options[2–4] ≤30 each,
    durationDays ∈ {1,3,7,14} } }` — the #101 poll constraints, enforced by the Zod
    schema (#102 §4).
  - **DOCUMENT** → `{ commentary?, document { templateId, slides[2–15] } }` — structured
    slide fields per #108 §3. **`templateId` resolution happens inside this step**
    (#108 §4): if `input.stylePreset` was supplied it is **stamped** authoritatively
    (the model cannot override it); if omitted, the model picks a `StylePreset` and Zod
    validates it is a real preset. `slides`, `pdfKey`, and `pageCount` are *not* set
    here — only the slide source; the render is `RENDER_PDF`'s job.
- **Writes:** `content` slot.
- **Emits:** `usage.tick` per LLM turn via `ctx.meter.record` (#104 §7).
- **Failure:** an LLM transport error → `WorkflowError { retryable }`. A **Zod-invalid
  output that survives the inline repair retry is terminal** — see §8 (this doc resolves
  the #103 §7 / #104 §8 conflict).

### `RENDER_PDF` — code (deterministic template fill + Browserless) — *conditional:
`type === DOCUMENT`*

- **Purpose:** turn `document.slides` into a rendered LinkedIn-document PDF in R2.
- **Reads:** `input` (`artifactId, version`), `content.document` (`templateId, slides`).
- **Calls:** `CarouselRendererService` — #108 §6 owns the `assembleHtml → htmlToPdf → R2
  uploadFile` chain, the boot-precompiled templates, and the R2 key convention. #109
  fixes only what this step reads and writes into `RunState`.
  - **Interlock note for #110 (StepContext gap):** #103 §10's `StepContext` exposes
    `agent / artifacts / meter / emit / run / logger` but **no renderer role**, while
    #108 §6 has this step call `CarouselRendererService`. #110 should either add a
    narrow `renderer: CarouselRenderer` role interface to `StepContext` (consistent with
    the engine's "depends on interfaces, not concrete services" principle, #103 §10) or
    resolve `CarouselRendererService` once in the worker bootstrap alongside the other
    roles. Recommended: the role-interface route, so `RENDER_PDF` mocks as trivially as
    every other step under the repo's manual-construction test style.
- **Writes:** `render = { pdfKey, pageCount: slides.length }` slot (#108 §6). Note the
  `pdfKey` (not `pdfUrl`) naming — #108 §7's private-bucket correction; #110 propagates
  the rename across #102 §4 / #103 §2–3 / #106 / #107.
- **Emits:** **no `step.progress`** — the render is one atomic `htmlToPdf` call with no
  honest per-page signal (#108 §6, superseding #107's speculative `pageRendered`). The
  core's `step.started/completed` bracket it. `usage.tick` for the Browserless-render
  surcharge via `ctx.meter.record({ kind: 'render', amount: 1 })` (#103 §9; #105 owns the
  amount).
- **Failure:** a Browserless timeout/failure is **retryable** (transient, #103 §7). An
  unknown `templateId`/`slide.type` at assembly is **terminal** — Zod already validated
  the content at `GENERATE`, so it should never occur and re-running cannot fix it
  (#108 §6).

### `PERSIST_VERSION` — code — *always*

- **Purpose:** write the finished content onto the pre-created version and flip it
  `READY` (the run's only durable content write; #103 §8 idempotency spine).
- **Reads:** `input` (`artifactId, version`), `content`, `render?` (documents).
- **Calls:** `ctx.artifacts.setVersionContent(artifactId, version, content, {render?, title?})`
  (the `ArtifactWriter` role, #103 §10) — writes `content`, stores the initial
  family title, folds `render.pdfKey` +
  `pageCount` into `content.document` for documents, and sets `status: GENERATING →
  READY` (#102 §2's lifecycle).
- **Writes:** no RunState slot (terminal step); side effect is the artifact version
  reaching `READY`.
- **Emits:** the core emits `step.completed` then `run.completed { artifactId, version }`,
  on which the engine calls `meter.commit(runId)` — the **only** real credit debit,
  charged once for the winning attempt (#103 §9).
- **Failure:** a DB write error is **retryable**; the write targets the fixed
  `(artifactId, version)`, so a whole-job retry overwrites rather than appends —
  idempotent, no duplicate versions (#103 §8).

## 3. Per-workflow pipelines

Each pipeline is an instantiation of §1's builder; the step bodies are §2's catalogue.
The tables below give the **concrete ordered run** with the AI/code tag and the
per-step RunState delta, so #110 can lift them straight into implementation tickets.

### 3.1 POST

**INITIAL, research-off** (list #1 — the "quick post" collapse, #100):

| Order | Step | AI/code | Reads | Writes |
|---|---|---|---|---|
| 1 | `RESOLVE_INPUT` | code | `BuildInput` | `input` |
| 2 | `GENERATE` | **AI** | `input` | `content = { commentary }` |
| 3 | `PERSIST_VERSION` | code | `input, content` | — (version → READY) |

**INITIAL, research-on** (list #2 — the "insight post" collapse): identical, with
`RESEARCH` (AI) inserted at order 2 — reads `input`, writes `research` + persists
`researchContext`; `GENERATE` then also reads `research`.

**REFINE** (list #3): `RESOLVE_INPUT` additionally seeds `refine` (+ cached `research`),
`GENERATE` reads them, no `RESEARCH` step. See §5.

### 3.2 POLL

**Structurally identical to POST** (lists #4/#5/#6 mirror #1/#2/#3). The *only*
differences are inside `GENERATE` and `PERSIST_VERSION`:

| Order | Step | AI/code | Reads | Writes |
|---|---|---|---|---|
| 1 | `RESOLVE_INPUT` | code | `BuildInput` | `input` |
| (2) | `RESEARCH` | **AI** | `input` | `research` (+ `researchContext`) — *research-on only* |
| 2/3 | `GENERATE` | **AI** | `input, research?` | `content = { commentary?, poll {…} }` |
| 3/4 | `PERSIST_VERSION` | code | `input, content` | — (version → READY) |

- **No upload step, ever** — a poll is inline JSON with no binary asset (#101 §1, §5);
  it never touches R2, the `media-upload` queue, or `RENDER_PDF`. The whole poll object
  is assembled at *publish* time (#106), not in the generation pipeline.
- **Poll constraints are a `GENERATE`-boundary concern** — the Zod poll schema (#102 §4,
  from #101) rejects out-of-range questions/options/durations; a violation that survives
  the inline repair retry is terminal (§8).
- **Research is available for polls** (§4) — a topical poll can be informed by fresh
  findings exactly like a post; the builder makes no exception.

### 3.3 DOCUMENT (carousel)

**INITIAL, research-off** (list #7):

| Order | Step | AI/code | Reads | Writes |
|---|---|---|---|---|
| 1 | `RESOLVE_INPUT` | code | `BuildInput` | `input` |
| 2 | `GENERATE` | **AI** | `input` | `content = { commentary?, document { templateId, slides } }` |
| 3 | `RENDER_PDF` | code | `input, content.document` | `render = { pdfKey, pageCount }` |
| 4 | `PERSIST_VERSION` | code | `input, content, render` | — (version → READY) |

**INITIAL, research-on** (list #8): `RESEARCH` (AI) inserted at order 2; `GENERATE`
reads `research`. Full five-step chain.

**REFINE** (= list #7 shape): `RESOLVE_INPUT` seeds `refine` + cached `research`, no
`RESEARCH`; `GENERATE` re-authors slides from `priorContent + feedback`; **`RENDER_PDF`
re-runs**, rendering to the *new* version's key `artifacts/${artifactId}/${newVersion}/
document.pdf` (version-scoped, never clobbers the prior render — #108 §7). See §5.

- **`RENDER_PDF` is what gates `READY` for documents** — the version stays `GENERATING`
  until `pdfKey` is written (#102 §2, #108 §7). POST/POLL reach `READY` at
  `PERSIST_VERSION` with no render.
- **The rendered PDF *is* the document's preview/thumbnail** — no separate thumbnail
  asset for launch (#108 §7).

## 4. Research invocation & skip rules

One rule, applied uniformly to all three types:

- **Runs** iff `withResearch === true` **and** `kind === INITIAL`. This is the sole
  invocation point (§1 builder). Research-on ≈ the old insight post; research-off ≈ the
  old quick post (#100).
- **Uniform across types** (settled decision): POST, POLL, and DOCUMENT honor
  `withResearch` identically — no per-type restriction. Rationale: the builder is
  type-agnostic on the research axis (#103 §2), a poll/carousel benefits from topical
  findings exactly as a post does, and special-casing would add surface for no gain.
  - *Rejected — restrict research to POST.* Would fork the clean one-rule builder and
    deny polls/carousels timely grounding for no principled reason.
- **Skipped on REFINE — always** (#103 §11). A refine reuses the initial run's
  `researchContext` (seeded into the `research` slot by `RESOLVE_INPUT`), so it
  **re-charges no web-search surcharge** and adds no latency. If the original run was
  research-off, there is simply no cached research and `GENERATE` runs on
  prompt + feedback alone.
- **Skipped on whole-job retry of an INITIAL research run — NO.** A retry re-runs the
  whole job from step 1 (#103 §7); for an INITIAL run the builder still contains
  `RESEARCH`, so it **re-executes** (a fresh Tavily pass). This matters for §8: the
  "retry is cheap because research is cached" premise holds only for REFINE, not for a
  retried INITIAL run.

## 5. Refine-run variants

A refine is a **new run** (`kind: REFINE`) over an existing artifact that appends a new
`GENERATING` version (#102 §5, #103 §11). Per type:

- **POST / POLL refine** (`RESOLVE_INPUT → GENERATE → PERSIST_VERSION`):
  - `RESOLVE_INPUT` builds `input` from the family-level `source
    {prompt, withResearch, stylePreset}` (#102 §7), plus `refine = { priorContent,
    feedback }` (prior version content + new feedback) and `research` copied from the
    artifact's latest `COMPLETED` `WorkflowRun.researchContext`.
  - `GENERATE` consumes `refine` (prior content + feedback drive the revision prompt —
    #104 §4) and any cached `research`.
  - `PERSIST_VERSION` writes the new version `READY`.
- **DOCUMENT refine** (`RESOLVE_INPUT → GENERATE → RENDER_PDF → PERSIST_VERSION`):
  as above, **plus `RENDER_PDF` re-runs** on the revised slides, writing to the new
  version's R2 key. The theme (`templateId`) carries forward from the prior version
  unless the user changes it (#108 §4); `GENERATE`'s stamp/pick logic (§2) applies to
  the refine's `stylePreset` the same way.

Common to all: **no `RESEARCH` step** (research is cache-seeded, §4); the revision-prompt
shape is #104's concern; #109 fixes only the slot flow and the research-skip.

## 6. RunState slot lifecycle

The complete I/O contract, one row per slot (#103 §3's `RunState`), showing which step
sets it and which read it — the "inputs/outputs through the run state" #109 owns:

| Slot | Type | Set by | Read by | Notes |
|---|---|---|---|---|
| `input` | `BuildInput` | `RESOLVE_INPUT` | every downstream step | the request + fixed target `(artifactId, version)` |
| `refine` | `{ priorContent, feedback }` | `RESOLVE_INPUT` (REFINE only) | `GENERATE` | absent on INITIAL |
| `research` | `ResearchResult` | `RESEARCH`, **or** `RESOLVE_INPUT` on REFINE (from cache) | `GENERATE` | absent when research-off and no cache |
| `content` | `ArtifactContent` (Zod union) | `GENERATE` | `RENDER_PDF` (document), `PERSIST_VERSION` | the typed per-type payload |
| `render` | `{ pdfKey, pageCount }` | `RENDER_PDF` (document only) | `PERSIST_VERSION` | absent for POST/POLL |

- **Every step reads `input`** (it carries the fixed target and the request); guards fire
  only if an *optional* upstream slot a step needs is missing (a builder/programming bug,
  not control flow — #103 §3).
- **`research` has two producers, one consumer** — the RESEARCH step (INITIAL) or the
  cache-seed in RESOLVE_INPUT (REFINE). `GENERATE` reads it agnostic of origin.
- **`content` is the hinge** — the AI product every code step downstream serializes,
  renders, or persists.

## 7. AI vs. pure-code classification (consolidated)

| Step | Classification | Metered? | Nondeterministic? |
|---|---|---|---|
| `RESOLVE_INPUT` | **code** | no | no |
| `RESEARCH` | **AI** (agentic tool loop) | yes — `llm` per turn + `web_search` per call | yes |
| `GENERATE` | **AI** (single completion) | yes — `llm` per turn | yes |
| `RENDER_PDF` | **code** (deterministic render) | yes — `render` surcharge (fixed) | no |
| `PERSIST_VERSION` | **code** | no | no |

- **Exactly two AI steps.** Everything else is deterministic. The two metered
  *AI* steps carry token cost; `RENDER_PDF` carries a **fixed non-LLM surcharge** (a
  code step can still be metered — the classification axis (AI/code) and the metering
  axis are independent; #103 §9, #105).
- **The deterministic spine** (`RESOLVE_INPUT`, `RENDER_PDF`, `PERSIST_VERSION`) is what
  makes whole-job retry safe: re-running them reproduces identical side effects against
  the fixed `(artifactId, version)` (#103 §8).

## 8. Resolution — a post-repair Zod failure at `GENERATE` is **terminal**

The siblings left one live conflict (flagged by #108 §3 for reconciliation): #103 §7
classifies "Zod-invalid LLM output after a step's own internal retries" as **terminal**;
#104 §8 says "still invalid → throw `retryable`." **#109 resolves it in favour of
#103 §7: terminal (`WorkflowError { retryable: false }` → BullMQ `UnrecoverableError`).**
The version ends `FAILED` with the validation reason; no whole-job retry.

**Jurisdiction.** #103 owns the retry *mechanism* (transient → `retryable` rides
`attempts: 3`; terminal → `UnrecoverableError`) — this doc doesn't touch that. What
#109 fixes, as the ticket that defines the concrete pipeline behaviour, is *which arm
this specific `GENERATE` throw takes* — a per-step classification, which is squarely a
pipeline concern. #108 §3 parked the reconciliation for #110; #109 supplies the resolved
position and its reasoning **for #110 to ratify** into the PRD, rather than leaving the
seam open for #110 to rediscover.

Reasoning:

1. **The cheap, well-informed resample already happened.** `generate()` does one **inline
   repair retry** re-prompting with the exact Zod error (#104 §8). That is a warm resample
   *with the failure context in the prompt*. A BullMQ whole-job retry, by contrast, starts
   cold from step 1 — the repair context is gone (each attempt rebuilds `RunState` fresh),
   so it is a *worse*-informed resample than the one that already failed.
2. **#104 §8's "cheap because research is cached" premise is false for INITIAL runs.** A
   retried INITIAL research run **re-executes `RESEARCH`** (§4) — the builder keeps the
   step for `kind === INITIAL`; only REFINE reads cached research. So the retry re-runs a
   full Tavily pass plus a cold generation, not the cheap cached path the retryable
   argument assumes.
3. **It is exactly the case #103 §7 names to protect against** — "retrying just burns time
   and credits" on output the model has now failed to schema-fit twice with the error in
   hand. Terminal bounds worst-case spend.
4. **The user is not stuck.** #102 §2 deliberately keeps `FAILED` versions visible in the
   library; the user can refine with adjusted feedback or start a new run — a
   human-in-the-loop resample that is strictly more useful than a blind retry.

Consequence for the pipeline: `GENERATE`'s failure handling has **two arms** —
LLM/transport error → `retryable` (rides the `attempts: 3` budget); Zod-invalid after
one inline repair → `terminal`. The terminal-failure handler (#103 §8) sets the target
version → `FAILED`, sets the `WorkflowRun` → `FAILED`, emits `run.failed`, and commits no
credits. **This supersedes #104 §8's `retryable` for this specific throw**; #110 should
ratify the resolution and adjust #104's migration note accordingly.

*Rejected — retryable (side with #104 §8).* Relies on a premise (cached-research retry)
that only holds for REFINE, spends a full research+generation on a cold resample less
informed than the inline repair that just failed, and risks three attempts on a
schema-fit failure the model has already demonstrated. The inline repair retry is the
right place for a resample; the BullMQ budget is for transient infra, not content.

## 9. Boundaries (owned by other tickets)

| Concern | Owner |
|---|---|
| Engine loop, `WorkflowStep` enum, builder, `RunState` typing, `WorkflowRun` record, emission envelope, retry taxonomy, credit-hook timing | #103 |
| `AgentRunner` (`research` / `generate`), tool loop, per-type & revision prompts, inline repair retry, usage hooks | #104 |
| `ArtifactContent` Zod union, `ArtifactWriter.setVersionContent`, version status, R2 key convention | #102 |
| `Slide` shape, `CarouselRendererService` internals, template registry, `pdfUrl→pdfKey` rename | #108 |
| LinkedIn poll/document API constraints & publish-time content assembly | #101 / #106 |
| Post binding, connected-account, publish, scheduling | #106 |
| SSE endpoint, client event schema, `Last-Event-ID` replay, heartbeats | #107 |
| Credit denomination, token→credit rates, `llm`/`web_search`/`render` surcharge amounts | #105 |
| **StepContext renderer role for `RENDER_PDF`** (gap surfaced in §2) | #110 to place (recommended: role interface) |

## 10. Migration note

Per the #100 clean write-over (relaunch, no users): **this is a design doc, no code of
its own.** It fixes the pipelines the #103 engine executes; implementation lands with
#103's `WorkflowStep` enum, the §2 step handlers under `src/workflow/steps/`, and the
worker rewiring. Two items for #110 to carry from here: (a) the `GENERATE` Zod-failure
resolution (§8, terminal — adjust #104's migration note), and (b) the `StepContext`
renderer-role gap for `RENDER_PDF` (§2 / §9).
