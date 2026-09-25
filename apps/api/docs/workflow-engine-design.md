# Workflow Engine — Design

> Status: design spec for wayfinder map #99, ticket #103 (grilling outcome).
> Author: generated for Christopher Pam. Decisions settled in a grilling session
> on 2026-07-09.
> Supersedes the current `src/workflow/engine/*` (the `PostDraft`-era engine).
> **The old engine is absorbed, not preserved** — per the #100 resolution,
> `quickPostLinkedin`/`insightPostLinkedin` collapse into one artifact-build flow
> toggled by `withResearch`; the old engine can be deleted. This reverses the stale
> "old engine stays untouched" wording in the #103 issue body (see map #99 charter
> #3, revised 2026-07-08).

Feeds the final spec assembly (#110). Interlocking tickets are referenced inline at
each boundary.

## Framing (charter-derived givens)

- **One engine, one build flow.** A single artifact-build pipeline serves all
  generations. Two axes vary it: `withResearch` (on/off — the collapse of
  quick/insight per #100) and artifact `type` (`POST` | `POLL` | `DOCUMENT` per
  #102). There is no separate "quick" vs "insight" workflow.
- **Executes in the BullMQ worker** (charter #4); step events publish to Redis
  pub/sub keyed by run id; the HTTP server relays them over SSE (#107).
- **Iteration is refine-after-completion** (charter #5) — no mid-run pause/resume.
  A refine is a *new run* over an existing artifact that appends a new version
  (#102 §5).
- **The engine serves the #102 artifact library.** `POST /artifacts` (and
  `/refine`) create the artifact + `GENERATING` version *first*, then enqueue a run
  that fills that fixed version. The engine never creates artifacts; it fills
  versions.
- **The engine is a deep, well-sealed module.** It depends on *narrow role
  interfaces* (agent loop, artifact writer, credit meter), implemented by the
  modules that own them (#104 / #102 / #105). #103 owns the engine, the step model,
  the run record, the event-emission contract, error/retry semantics, and refine
  re-entry — not those modules' internals.

The end-to-end flow the engine runs:

```
resolveInput → [research] → generate(type) → [renderPdf (DOCUMENT only)] → persistVersion
```

Bracketed steps are conditional (composed in by the builder — §2).

---

## 1. Step model — linear ordered list, typed state

The engine keeps the old model's **linear ordered step list** (it fits genuinely
linear pipelines and matches the team's mental model) but **replaces the untyped
`{ data, initialInput, metadata: Record<string, any> }` bag** with a typed,
progressively-built run-state.

- A `WorkflowDefinition` is still `{ name, steps: WorkflowStep[] }`.
- `runWorkflow` still loops the steps in order.
- What changes: how steps are *composed* (§2), how state is *typed* (§3), and the
  cross-cutting concerns the engine now owns (events §5–6, retry §7, credits §9).

**Rejected — graph/DAG with conditional edges.** These flows have no real
branching or fan-out; a DAG would be machinery we never exercise. The two variation
axes are handled by *composition* (§2), not runtime edges.

## 2. Composition — `buildWorkflow({ type, withResearch })`

The concrete step list for each of the 6 `(type × withResearch)` combinations is
assembled by a **builder** from a few named fragments, rather than 6 enumerated
static lists (which drift) or one maximal skip-flag list (which lies about what
runs and pollutes the event stream):

```ts
function buildWorkflow({ type, withResearch, kind }: BuildSpec): WorkflowDefinition {
  return {
    name: `artifact:${type}`,
    steps: [
      WorkflowStep.RESOLVE_INPUT,
      // refine reuses cached research → research fragment omitted (see §8)
      ...(withResearch && kind === RunKind.INITIAL ? [WorkflowStep.RESEARCH] : []),
      WorkflowStep.GENERATE, // dispatches on `type` internally
      ...(type === ArtifactType.DOCUMENT ? [WorkflowStep.RENDER_PDF] : []),
      WorkflowStep.PERSIST_VERSION,
    ],
  };
}
```

- The **emitted step sequence is honest** — only steps that actually run appear.
  This matters because that sequence feeds the SSE progress stream (#107) and the
  progress-percentage math.
- `GENERATE` dispatches on `type` (POST → commentary; POLL → poll object; DOCUMENT
  → slides). The per-type generation prompts are the agent's concern (#104); the
  slide/template shape is #108's. The step just calls `ctx.agent` and writes the
  typed `content` slot.
- `RENDER_PDF` runs only for documents (gates `READY` per #102 §2); it calls the
  existing Browserless→PDF path and writes the R2 `pdfUrl` (key convention from
  #102 §8: `artifacts/${artifactId}/${version}/document.pdf`).

**The registry** maps the single *content-build* concept to this builder, not to a
static per-type array. There is no longer a `ContentType`-keyed registry of hand-
written step lists.

## 3. Run-state typing — named slots + typed patch

The step list is assembled *dynamically* by the builder, so TypeScript can't infer a
fully-chained input→output pipeline (that only works for a fixed tuple of steps).
The pragmatic model: **one `RunState` interface with typed, named optional slots;
each step returns a typed partial patch the engine shallow-merges.**

```ts
interface BuildInput {
  type: ArtifactType;
  prompt: string;
  withResearch: boolean;
  stylePreset?: StylePreset;
  userId: string;         // owner (for credit assert/commit)
  artifactId: string;     // fixed target family
  version: number;        // fixed target version (already GENERATING)
  kind: RunKind;          // INITIAL | REFINE
}

interface RunState {
  input: BuildInput;                          // set by RESOLVE_INPUT
  research?: ResearchResult;                  // set by RESEARCH, or seeded on refine (§8)
  refine?: { priorContent: ArtifactContent;   // set by RESOLVE_INPUT on a refine run
             feedback: string };
  generatedTitle?: string;                    // set by GENERATE on INITIAL only
  content?: ArtifactContent;                  // set by GENERATE (Zod union per #102 §4)
  render?: { pdfUrl: string; pageCount: number }; // set by RENDER_PDF (documents)
}

type StepHandler = (state: RunState, ctx: StepContext) => Promise<Partial<RunState>>;
```

- Each step **reads the slots it needs** (guarding at runtime with a clear
  `WorkflowError` if a required upstream slot is missing) and **writes only its own
  slots** via the returned patch. No `any`; slots are strongly typed.
- The **returned-patch style (not in-place mutation)** gives the event layer a clean
  "here's what this step produced" hook and keeps each step's read/write surface
  honest.
- The builder guarantees ordering, so the runtime precondition guards rarely fire —
  they're a safety net, not control flow.

**Rejected — fully generic per-step `In`/`Out` compile-time chaining.** Maximal
safety, but incompatible with a runtime-built dynamic step array; it would force us
to give up the builder or hand-write a typed chain per combination.

**Rejected — a single mutable object steps mutate in place** (old style, but typed).
In-place mutation makes "what did this step change" invisible to the event layer.

## 4. Run record — durable `WorkflowRun` collection

`runId` is the `_id` of a dedicated **`WorkflowRun` Mongo collection**, reused as the
BullMQ `jobId`. This gives one durable record per generation, 1:1 with a job, with a
clean identity chain **run ↔ job ↔ Redis channel** (`workflow:run:{runId}`), and it
decouples durable state from BullMQ's eviction policy (jobs are removed on
completion). It's the home #102 §7 already points at for research context.

```ts
enum RunKind   { INITIAL = 'INITIAL', REFINE = 'REFINE' }
enum RunStatus { RUNNING = 'RUNNING', COMPLETED = 'COMPLETED', FAILED = 'FAILED' }

WorkflowRun {
  _id:            ObjectId          // = runId = BullMQ jobId
  user:           ObjectId<User>
  artifact:       ObjectId<Artifact>
  targetVersion:  number            // the version this run fills
  kind:           RunKind
  status:         RunStatus
  input:          BuildInput        // the request that spawned the run
  currentStep?:   WorkflowStep      // updated at each step boundary (reconnect fallback)
  researchContext?: ResearchResult  // persisted when RESEARCH completes (refine reuse + debug)
  creditsUsed:    number            // attempt-scoped accumulator (reset each attempt — §9)
  failureReason?: string            // set when FAILED
  createdAt, updatedAt              // Mongoose timestamps
}
```

**What is persisted, and when** (charter #5 fixed no mid-run resume, so there are no
per-step checkpoints *for resume* — a retry re-runs the whole job):

- **On create** (at enqueue): `{ status: RUNNING, kind, artifact, targetVersion,
  input, creditsUsed: 0 }`.
- **On each step boundary:** update `currentStep` (+ `status`). One cheap
  `updateOne` between steps — enough for the SSE-reconnect status fallback (#107)
  and post-mortem debugging.
- **When `RESEARCH` completes:** persist `researchContext` (the one durable thing
  refine reuse needs).
- **During run:** accumulate `creditsUsed` via `meter.record` (§9).
- **On terminal:** set `status: COMPLETED | FAILED` (+ `failureReason`).
- **Never** copies the generated content — that lives on the artifact version (#102);
  the run holds only the `(artifact, targetVersion)` reference.

**Rejected — no collection (runId = jobId, state in job data).** Dies on job
eviction; can't serve refine's cached-research need or reconnect; forces
`removeOnComplete: false` (unbounded Redis growth).

**Rejected — snapshot the whole `RunState` after every step.** Enables a resume we
explicitly don't do (charter #5), duplicates content already on the artifact, and
means heavier writes.

**Rejected — fold the run record into the artifact version.** Already rejected by
#102 §7 (keeps research off the artifact to avoid the `PostDraft` bloat).

## 5. Event emission — who emits what

The engine is the **producer**; #107 owns the SSE endpoint, the client-facing event
schema/naming, `Last-Event-ID` cursoring, heartbeats, and log retention. #103 fixes
the *internal* emission contract.

**The engine core wraps each step** (it owns the loop), so lifecycle events are
guaranteed complete and match the honest builder sequence (§2). **Steps emit only
what the core can't observe.**

| Event | Emitted by | `data` |
|---|---|---|
| `run.started` | core | `{ kind, type, steps: WorkflowStep[] }` |
| `step.started` | core (wrap) | `{ step, index, total }` |
| `step.completed` | core (wrap) | `{ step, index, total }` |
| `step.failed` | core (wrap) | `{ step, retryable, message }` |
| `step.progress` | step (`ctx.emit`) | `{ step, ...fine-grained }` (e.g. `sourcesFound`) — optional |
| `usage.tick` | `ctx.meter.record` | `{ kind, credits, detail? }` |
| `run.completed` | core | `{ artifactId, version }` |
| `run.failed` | core | `{ failureReason }` |

- `usage.tick` is emitted **by `meter.record`** (§9), *not* raw `ctx.emit` — the one
  call both accounts and announces. `ctx.emit` is reserved for `step.progress`.
- `step.failed` on a **non-terminal** (will-retry) failure leaves the version
  `GENERATING`; only the terminal handler flips it (§8).

**Rejected — engine emits only run start/end; steps emit their own lifecycle.**
Every step would have to remember to emit start/complete → drift and gaps in the
progress stream.

**Rejected — a rich, highly-granular vocabulary defined here.** Over-specifies what
is really #107's client-facing schema and couples the engine to presentation.

## 6. Emission envelope, channel, and ordering

```ts
interface RunEvent {
  runId: string;
  seq:   number;   // monotonic per run, engine-assigned, starts at 1
  type:  RunEventType;
  ts:    number;   // epoch ms
  data:  unknown;  // type-specific (§5 table)
}
```

- **Channel:** `workflow:run:{runId}` (per-run Redis pub/sub channel). The client
  gets `runId` from the `202` kickoff response (#102) and #107 subscribes on its
  behalf.
- **`seq`:** the **engine emitter assigns** a monotonic per-run integer. It's the
  ordering key and the natural basis for #107's `Last-Event-ID`. Steps supply only
  `{ type, data }`; the core stamps `runId` / `seq` / `ts`.
- **The emitter both publishes and appends.** A single production point (a) publishes
  the envelope to the per-run channel for live relay and (b) appends it to a durable
  per-run event log. This removes the subscribe-race (events fired before a separate
  persister subscribes are lost) and gives #107 an ordered, replayable log to build
  on.
  - **Recommended log mechanism:** a bounded **Redis Stream** per run (natural
    stream IDs, `XADD` + `MAXLEN` trimming, `XRANGE` replay-after-`seq`). This is a
    recommendation — #107 owns the final transport/retention choice and may map
    `seq` ↔ stream ID as it sees fit.

**Rejected — fire-and-forget pub/sub only, #107 persists by subscribing.** Cleaner
ownership line, but reintroduces the subscribe-race and adds a second consumer.

## 7. Error / retry semantics

A retry re-runs the **whole** job from step 1 (no per-step checkpoints, §4). Some
failures are transient (LLM 429/5xx, network, Browserless timeout) and worth
retrying; others are terminal (invalid input, insufficient credits, Zod-invalid LLM
output after a step's own internal retries) and retrying just burns time and credits.

- **BullMQ config:** `attempts: 3`, `backoff: { type: 'exponential' }`.
- **Error taxonomy:** a `WorkflowError { retryable: boolean; reason: string }`.
  - **Transient** (`retryable: true`) — thrown normally, rides the attempt budget.
  - **Terminal** (`retryable: false`) — the engine rethrows as BullMQ's
    `UnrecoverableError`, which stops retries immediately regardless of attempts
    left.
- This mirrors how the existing `media-upload` worker already reasons about
  `attemptsMade` vs `opts.attempts` (`workflow.worker.ts`), so it's idiomatic here.

**Rejected — no retries (every failure terminal).** Throws away the easy win on the
transient LLM/network blips that dominate real failures.

**Rejected — unbounded/high retries.** Risks credit burn and long-stuck runs on
genuinely-terminal errors.

## 8. Failure side-effects and re-run idempotency

**Re-run idempotency (why whole-job retry is safe):** a run targets a *fixed*
`(artifactId, version)` that #102 created as `GENERATING` at kickoff. Every step —
including `PERSIST_VERSION` — writes to that same fixed version, so a retry
*overwrites* content rather than appending a new version. No duplicate versions. The
only non-idempotent side-effect is usage accounting, handled by the attempt-scoped
reset in §9.

**Terminal-failure handler** (a job-level `failed` handler mirroring the
`media-upload` `exhausted` pattern in `workflow.worker.ts`), fired **only** on
attempts-exhausted or `UnrecoverableError`:

1. Set the artifact's **target version → `FAILED`** with `failureReason` (#102 §2).
2. Set **`WorkflowRun` → `FAILED`** with `failureReason`.
3. Emit **`run.failed`** `{ failureReason }` (terminal SSE event for #107).
4. **No credit commit** (§9) — the user is not charged for a failed run.

Intermediate (will-retry) failures emit `step.failed` and leave the version
`GENERATING`.

**Rejected — delete the artifact/version on failure.** Loses #102's deliberate
`FAILED` version status; the user can't see the failed generation in the library to
refine or retry it.

## 9. Credit-metering hooks (interface + timing)

`CreditMeter` is a #103-defined narrow interface, *implemented* by #105 (which owns
denomination, token→credit exchange rates, and surcharge amounts). #103 owns only
*where the hooks fire*.

```ts
interface CreditMeter {
  assertBalance(userId: string): Promise<void>;             // pre-run guard
  record(usage: { kind: UsageKind; amount: number; detail?: unknown }): void; // during
  commit(runId: string): Promise<void>;                     // post-run debit
}
```

- **Pre-run** — the engine calls `assertBalance(userId)` before the step loop.
  Insufficient balance → **terminal** `WorkflowError` (no retry); the failure
  handler (§8) sets version + run → `FAILED` reason `"insufficient credits"`.
  *(The HTTP endpoint should also pre-check for a fast 4xx — that's #105/#102; this
  is the defensive run-start guard.)*
- **During run** — steps call `ctx.meter.record(...)` for each LLM call and each
  fixed surcharge (web search, Browserless render). `record`:
  1. accumulates into an **attempt-scoped** `creditsUsed` on the `WorkflowRun`, and
  2. emits the `usage.tick` event (§5).
- **Per attempt** — the engine **resets** the attempt-scoped `creditsUsed` at the
  start of each attempt, so a whole-job retry can't double-count.
- **Post-run** — on `run.completed` the engine calls `meter.commit(runId)`: the
  **only** real debit, for the winning attempt's usage. On failure → **no commit**.

**Net effect:** users are charged **once, only for successful runs**. Failed runs and
burned retries cost the user nothing (we absorb the transient-failure cost). There is
**no mid-run cutoff** — the agent loop's max-iteration cap (#104) bounds worst-case
spend; #105 may add a cutoff later, and these hooks leave room.

**Rejected — debit incrementally as usage happens.** Accurate live balance, but
charges for failed/retried runs and needs refund logic.

**Rejected — pre-authorize an estimate and settle at end.** Cleanest accounting, but
needs an estimator and a hold mechanism we don't have.

## 10. Step context (`ctx`)

Steps receive a `StepContext` of **narrow role interfaces** — defined by the engine
(its needs), implemented by the owning modules — so the engine depends on interfaces,
not concrete services, and steps mock trivially under the repo's
manual-construction test style.

```ts
interface StepContext {
  logger:    Logger;
  agent:     AgentRunner;    // #104 — research + generation via the tool-calling agent loop
  artifacts: ArtifactWriter; // #102 — set version content, flip status, read prior version
  meter:     CreditMeter;    // #105 — §9
  emit:      (e: { type: RunEventType; data: unknown }) => void; // step.progress only (§5)
  run:       RunRecordHandle; // read/patch this WorkflowRun (researchContext, currentStep)
}
```

- `AgentRunner`, `ArtifactWriter`, `CreditMeter`, `RunRecordHandle` are **thin
  interfaces scoped to what steps actually call** — not the full surfaces of
  `AgentService` / the artifact service / the credit service.
- The **concrete instances are resolved once in the worker bootstrap** (the existing
  `app.get(...)` pattern in `workflow.worker.ts`) and passed into `runWorkflow` as
  `ctx`.
- `emit` is scoped so the engine core stamps `runId` / `seq` / `ts`; steps supply
  only `{ type, data }`.

**Rejected — pass concrete NestJS services.** Couples the engine to those modules'
full surfaces and drags heavy mocks into step tests.

**Rejected — pass the Nest `ApplicationContext`/injector.** Maximum flexibility,
worst testability, hidden dependencies.

## 11. Refine re-entry

A refine is a **new run** (`kind: REFINE`) over an existing artifact. #102's
`POST /artifacts/:id/refine {feedback}` appends a new `GENERATING` version and
returns `202 {artifactId, version, runId}`, then kicks off the run that fills it.

- **Seeding.** `RESOLVE_INPUT` builds `RunState` with:
  - `input` = the family-level `source {prompt, withResearch, stylePreset}` (#102 §7),
  - `refine = { priorContent, feedback }` — prior version content + the new feedback,
  - `research` = **copied from the artifact's latest `COMPLETED` `WorkflowRun`'s
    `researchContext`** (if any).
- **Research is skipped.** The builder omits the `RESEARCH` fragment for
  `kind: REFINE` (§2) — the `research` slot is pre-filled from cache. This is exactly
  what #102 §7 parked research context on the run record to enable: refine stays
  cheap and fast, and **re-charges no web-search surcharge**. If the original was
  research-off, there's simply no cached research and `GENERATE` runs on
  prompt + feedback.
- **`GENERATE` consumes the `refine` slot** — prior content + feedback inform the
  revision. The *revision prompt* shape is #104's concern; #103 only defines the
  slot and the research-skip.

**Rejected — always re-run research on refine.** Freshest sources, but re-charges the
web-search surcharge and adds latency on every tweak.

**Rejected — a per-refine "re-research" toggle now.** More surface than launch needs;
noted as future work.

## 12. Boundaries (owned by other tickets)

| Concern | Owner |
|---|---|
| Agent loop internals, tool registry, per-type/revision prompts | #104 |
| `AgentRunner` *implementation* (research + generation) | #104 |
| Credit denomination, token→credit rates, surcharge amounts, `Tier`/`Usage` schema; optional mid-run cutoff | #105 |
| `ArtifactWriter` *implementation*; artifact/version schema | #102 |
| Post binding, connected-account, publish, scheduling | #106 |
| SSE endpoint, client-facing event schema, `Last-Event-ID` replay, heartbeats, log retention | #107 |
| `Slide` internal shape / carousel templates / Browserless render details | #108 |

## 13. Migration note

Per the #100 resolution this is a clean write-over (relaunch, no users):

- `src/workflow/engine/*` and the `ContentType`-keyed `WorkflowRegistry` are rebuilt
  to this design; the `quickPostLinkedin` / `insightPostLinkedin` workflow
  definitions and their `ContentType` split are **deleted** (folded into the
  `withResearch` toggle).
- The `WorkflowStep` enum is redefined to the fragments in §2
  (`RESOLVE_INPUT`, `RESEARCH`, `GENERATE`, `RENDER_PDF`, `PERSIST_VERSION`);
  the `PostDraft`-era steps (`EXTRACT_INTENT`, `GET_QUERIES`, `CREATE_LINKEDIN_DRAFT`,
  …) are removed.
- A new `WorkflowRun` schema (§4) is added under `src/database/schemas`.
- The worker's `workflow` queue consumer (`workflow.worker.ts`) is rewired to build
  `StepContext` from the narrow role interfaces (§10) and to attach the
  terminal-failure handler (§8), reusing the `media-upload` `exhausted`-handler
  idiom already present.
- No data migration; there are no existing runs to preserve.
