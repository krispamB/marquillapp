# Artifact generation: performance improvement plan

> The plan for cutting the time from "Generate" to "artifact on screen", and for keeping that time flat when many users generate at once. Built from [artifact-generation-latency-audit.md](./artifact-generation-latency-audit.md) (per-run waits) and [artifact-generation-performance-model.md](./artifact-generation-performance-model.md) (call map, load), then checked line by line against the code on `main` at `de27671`, the installed SDKs (`@openrouter/sdk` 0.13.39, `bullmq` 5.66.5, `@tavily/core` 0.7.6, `puppeteer-core` 24.43.1) and 53 local DOCUMENT runs. Written 2026-10-18.
>
> **Measured** = read from local Mongo or from `node_modules`. **Est.** = inferred. Everything in this plan is behind config or a revert of one PR, and nothing changes model quality without passing an eval first.

## 1. Goals and where we start

| Run | Today | Target after this plan | Main levers |
| --- | --- | --- | --- |
| POLL | 5–12 s (est.) | 3–6 s, first text ~1 s | P3, P1 |
| POST | 8–20 s (est.) | 6–12 s, first text ~1 s | P1, P2, P3 |
| + research | +20–45 s (est.) | +4–10 s | R1, R3, R4, R5 |
| DOCUMENT | draft p50 **96 s**, p90 **173 s**; post-#189 draft p50 ~140 s; Repair turn p50 ~40 s; render session p50 15 s remote (measured) | draft est. 40–70 s, 1 Repair in <25% of runs, render 3–6 s | D1, D3, D2, D6/D5 |
| Burst of 100 users | ~100 min to drain, one job at a time (est.) | a few minutes, no failed runs from saturation | concurrency, queues, semaphore |
| Plumbing per run | 0.4–1.3 s | <0.3 s | A1–A4, A6, D4, D9 |

Production runs `GENERATION_MODEL=openai/gpt-6-luna-pro` (confirmed 2026-10-18), the same model as the local measurements. It reasons at `medium` by default and spends 9–22k output tokens to write 1–4k tokens of HTML, so M2 applies in production at full value.

## 2. What the code review changed in the audit

Three subagents re-read every item against the code. These corrections are folded into the plan below.

| Audit item | Correction |
| --- | --- |
| A7 (set `timeoutMs`) | **Does not work as written.** The SDK builds one `AbortSignal.timeout` for the whole call before its retry loop (`@openrouter/sdk/esm/lib/sdks.js:125-127`). Once it fires, every retry aborts at once and the loop spins until `maxElapsedTime` (1 h). A timeout while reading the body escapes as a raw `TimeoutError`, which `toLLMError` classifies as terminal. Replaced by an app-owned retry loop (§4, M3.1). |
| New | A provider failure after `200 OK` arrives as `ResponseValidationError` with `statusCode 200`, which `toLLMError` treats as terminal (no retry at all). |
| New | The SDK already honours `Retry-After` and adds jitter, but does not retry **429** (`retryCodes: ["5XX"]`, `funcs/chatSend.js:59`). |
| D1 (`low`/`minimal`) | Supported efforts differ per model. `gpt-6-luna-pro`: `max…low, none` (no `minimal`). `gpt-5.4`: `xhigh…low, none`, and **any value but `none` turns reasoning on**. `gpt-5-mini`: `high…minimal`, and `none` is a 400. So every effort key must default to "not sent". |
| D3 repair rate | "Half of runs repair" is pre-#189. On today's prompt: **10/27 runs (37%)**. The top code overall (`envelope.css.pageSelector`) is gone since #189. Today's targets: `page.safeArea`, `icons.colors`, `render.overlap`, `palette.pairings`. |
| D7 (fonts) | `render.fonts.failed` never occurred (0 of 82 render checks). All 14 RETRY sessions were `render.timeout`, hung in `connect`/`setup`, which is Browserless saturation or latency. D7 is a load-phase win only; the retry problem belongs to D5 and the semaphore. |
| D2 (patch Repairs) | Realistic saving is 5–15 s per Repair (reasoning dominates the turn), not 8–25 s. New XS precursor **D2a**: Repairs still re-emit `commentary` (≤3,000 chars) and `title`, which are thrown away. |
| D6 (CDP round trips) | Underestimated: ~12 removable round trips at ~300–450 ms each, so **4–5 s per remote session**. Also `page.pdf()` adds 3 trips (`waitForFonts: true` default, `IO.read`, `IO.close`). |
| D10 (drop JSON envelope) | Escaping is 4.7% of characters, about 1–2% of draft time on a reasoning model. **Dropped.** |
| A3 (`setCurrentStep`) | Awaited at every step boundary (3–5 per run): 75–500 ms, not 25–100 ms. |
| A4 (pre-generated `_id`s) | Only safe for INITIAL runs, and saves one round trip. **Dropped.** |
| Backlog 2 (priorities) | BullMQ OSS takes prioritised jobs only when `wait` is empty, and priority does not reserve capacity. Per-group concurrency is BullMQ Pro only. **Separate queues** are the fix. |
| Backlog 13 (index) | Right key is `{ user: 1, updatedAt: -1, _id: -1 }` (the library sorts by `updatedAt`). |
| New hazard | A job that stalls twice is failed inside Redis, but the worker emits only `stalled`, never `failed` (`bullmq/dist/esm/classes/worker.js:862`; Lua `moveStalledJobsToWait-8.lua:88`). `onFailed` never runs, so the run stays `RUNNING` and no `run.failed` reaches the user. Rare today; likely with concurrency and deploys. |
| Docs drift | The worker runs five queues (also `media-upload`), not four. `agent-loop-and-research-agent-design.md:265` claims research is cached on retry; it is not. |

## 3. Principles

1. **Measure first.** M0 lands before any tuning, so every later PR has a before and after.
2. **Defaults preserve today's behaviour.** Every new env key defaults to the current behaviour; rollout is a Railway variable change, and rollback is unsetting it.
3. **Quality is gated.** Anything that changes what the model writes (effort, prompts, model choice, research shape, patch Repairs) passes `bun run eval:documents` or a new text eval before it is switched on in production.
4. **Concurrency ships with its safety net.** Raising worker concurrency multiplies whole-job retries, deploy restarts and Browserless pressure. M3 must be in production before M4 raises the numbers.
5. **Contracts move together.** An SSE payload change updates `docs/api/runs.md`, `sse-progress-contract-design.md` and the web caller in the same PR (repo rule).

## 4. The plan

Seven milestones. Inside a milestone, PRs are independent unless marked. Sizes: XS < ½ day, S ≤ 1 day, M 2–4 days, L a week.

### M0. Measure (prerequisite for everything)

**M0.1 — Record what each model call costs in time and tokens (A8).** S.
- `llm/interfaces/llm.interfaces.ts`: `Usage` gains `reasoningTokens?`, `cachedTokens?`, `cacheWriteTokens?`, `latencyMs?`.
- `openrouter.strategy.ts:35-43` `toUsage`: read `usage.completionTokensDetails?.reasoningTokens`, `usage.promptTokensDetails?.cachedTokens` / `.cacheWriteTokens`. Time the call for `latencyMs`.
- `agent-runner.service.ts:73-78` `addUsage`: sum the new fields.
- DOCUMENT: widen `RunDiagnostics.recordModelTurn` (`workflow.types.ts:180-183`) and `DocumentDiagnostics` (`:129-171`) with `promptTokens`, `reasoningTokens`, `cachedPromptTokens` and a bounded `modelTurns: { call: 'draft'|'repair'|'envelope', model, effort?, completionTokens, reasoningTokens?, cachedTokens?, latencyMs, finishReason? }[]`. Carry over from earlier attempts (`document-run-diagnostics.ts:73-93`). Stored as `type: Object`, no migration.
- POST/POLL and research: add `WorkflowRun.llmUsage` (summed tokens, reasoning tokens, call count, total LLM ms), written in the same `$set` as `complete()`/`fail()` (`workflow-run.service.ts:155-162`). No extra round trip.
- Queue wait: record `queueWaitMs = job.processedOn - job.timestamp` on the run at pickup (the perf model §6 gap).
- Tests: `openrouter.strategy.spec.ts` (usage mapping; its config mock returns a string for every key), `agent-runner.service.spec.ts`, `document-run-diagnostics.spec.ts`, `workflow-run.service.spec.ts`.
- Docs: `document-generation-spec.md` §11.1.

**M0.2 — Baselines (no code).**
- Read production `GENERATION_MODEL`, `RESEARCH_MODEL`, Browserless plan (region, concurrent sessions), Redis plan connection cap, Atlas connection cap, Railway drain window.
- Production `renderAttempts[].phaseMs` and repair rounds, via `GET /diagnostics/documents` (spec §11.5) or the aggregation used for this plan.
- One `bun run eval:documents --concurrency 2 --json eval-baseline.json` on the production model (runbook: `docs/document-eval-runbook.md`). Keep the JSON; every later gate compares against it.
- After M0.1 has been in production for a few days: the reasoning share of DOCUMENT output tokens, and `queueWaitMs` p50/p90.

**Exit:** a baseline table (draft s, Repair s, repair rate, render s, queue wait, reasoning share) committed to this doc's §7.

### M1. Safe plumbing wins (no quality risk)

Each is XS–S, independent, and needs no eval.

| # | Change | Files | Saves | Size |
| --- | --- | --- | --- | --- |
| M1.1 | **A2 + A3** in one PR. Emit `run.completed` right after `run.complete`, then `await meter.commit()`, then `flush()` (emit is fire-and-forget, so the XADD overlaps the debit; never `Promise.all` complete + commit). Delete the `setCurrentStep` call, the handle method and its service method; keep the schema field optional. | `workflow/engine/workflow.engine.ts:75,95-104`, `workflow.types.ts:276`, `workflow-run.service.ts:136` | 0.1–0.5 s | XS |
| M1.2 | **D4** `Promise.all` the R2 PUTs; the cover keeps its own catch and maps to `coverFailure`. | `workflow/steps/render-pdf.step.ts:387-414` | 0.3–1 s prod | XS |
| M1.3 | **D2a** Repairs answer with `{ html }` only: new `documentRepairSchema`, last line of the Repair user message becomes "Answer with JSON {"html": …} only." System prompt stays byte-identical. | `agent-runner.service.ts:401-430`, `artifact/schemas/artifact-content.schema.ts:120-135`, `agent/prompts/artifact-generation.prompts.ts:295` | 100–750 output tokens per Repair | XS |
| M1.4 | **A1 + A6** (web). `useArtifactRun({ enabled: true })` (the hook already returns without a `runId`); replace the two clean-URL `router.replace` calls with `window.history.replaceState(window.history.state, "", cleanArtifactUrl)`. Leave the failure path and `/artifacts` redirect alone. Add the first `useArtifactRun.test.tsx` (bun:test + happy-dom, stubbed `EventSource`). | `apps/web/app/redesign/ArtifactConversationClient.tsx:201-202,219,249`, `useArtifactRun.ts` | 0.3–1 s to first progress | S |
| M1.5 | **D9** REFINE reads the base candidate from `run_candidate_sources` by `{ candidateSha256, role: 'ACCEPTED' }` (new index), verifies the hash, falls back to R2 on miss, mismatch or error; runs in `Promise.all` with `getLatestCompletedResearch`. | `workflow/steps/resolve-input.step.ts:73-131`, `workflow-run.service.ts`, `database/schemas/run-candidate-source.schema.ts` | 0.1–1.7 s per refine | S |
| M1.6 | **D8** Skip the cover when the probe already has findings: `RenderSessionOptions.skipCover?: (facts) => boolean`, passed as `f => judge(definition, f).length > 0`. Keep the PDF (its page count can add a finding). Run `bun run test:render`. | `document-render/render-session.ts:181-202`, `document-renderer.service.ts` | 0.1–2 s per failing session | S |
| M1.7 | **R3 (part 1)** Build the Tavily client once and pass `timeout` (`TAVILY_TIMEOUT_S`, default 10; the SDK default is 60 s). Depth becomes `TAVILY_SEARCH_DEPTH` (default `advanced`, so no change yet). | `agent/tools/search-web.tool.ts:38-43` | bounds the tail | XS |
| M1.8 | **P2** Move Zod `.refine()` rules into the JSON schema where strict mode can express them: `durationDays` → `z.literal([1,3,7,14])`; poll question `.regex(/\S/).max(140)`; options `.regex(/\S/).max(30)`; commentary `.max(3000)`. Keep the LinkedIn-count refines and option uniqueness (not expressible). Count the `first draft failed validation` warning before and after. | `artifact/schemas/artifact-content.schema.ts:21-79` | 4–15 s on runs that miss | S |
| M1.9 | **Drop exact duplicate POLL options** (decided 2026-10-18). Before validation, remove options that repeat an earlier one under the schema's own rule (`trim().toLowerCase()`), keeping the first. Only when ≥ 2 options remain; otherwise the uniqueness refine still fails and the Zod repair runs as today. A pure `dedupePollOptions(value)` in `artifact/schemas`, applied in `AgentRunnerService.generate` between `JSON.parse` and the schema check (not a Zod `.transform`, which would break the strict JSON schema). Log the count. | `agent/agent-runner.service.ts:316-326`, `artifact/schemas/artifact-content.schema.ts:63-68` | a full repair turn (4–15 s) on runs that repeat an option | XS |

Tests per item are listed in §8.

### M2. Reasoning effort (the largest single saving)

**M2.1 — Per-call LLM options plumbing.** S. Depends on M0.1.
- `CompletionOptions` gains `reasoningEffort?`, `sessionId?`, `model?` (and, for M3.1, `timeoutMs?`, `deadlineAt?`, `signal?`).
- `send()` maps `reasoningEffort` to `reasoning: { effort }` only when set (never also send the `reasoningEffort` shorthand). `sessionId` maps to `session_id`.
- New boot-validated keys, **all unset by default** (unset = nothing sent = today's behaviour; an unknown value fails boot):

  | Key | Call sites |
  | --- | --- |
  | `RESEARCH_REASONING_EFFORT` | research tool turns and the closing call (`agent-runner.service.ts:217-222`, `:282-286`) |
  | `GENERATION_REASONING_EFFORT` | POST/POLL `generate` and its Zod repair |
  | `DOCUMENT_DRAFT_REASONING_EFFORT` | `completeDocument('draft')` + envelope repair |
  | `DOCUMENT_REPAIR_REASONING_EFFORT` | `completeDocument('Repair')` + envelope repair |

- `complete()` stops hard-coding `this.generationModel` (`:604`, `:619`) and reports the model actually used to `onUsage` (needed by P3).
- `.env.example`: note that an effort on a non-reasoning model makes OpenRouter require reasoning-capable providers (`requireParameters: true` is already sent with schemas), which can 404.

**M2.2 — D11 session affinity.** XS. Add `sessionId` to the runner inputs (`GenerateInput`, `DocumentGenerateInput`, `DocumentRepairInput`, `ResearchInput`); steps pass `ctx.run.runId`. Watch `cacheWriteTokens` vs `cachedTokens` in M0.1 data: cache writes can bill at 1.25× input.

**M2.3 — Choose and switch on efforts (eval-gated, no code).**

| Model | Draft | Repair | Research |
| --- | --- | --- | --- |
| `gpt-6-luna-pro` (production, both keys) | try `low`, then `none` | try `none`, then `low` | try `low`, then `none` (Luna has no `minimal`) |
| `gpt-5.4` | leave unset | leave unset | leave unset |
| `gpt-5-mini` | — | — | `minimal` (`none` is a 400) |

Procedure: worker restarted per setting; `bun run eval:documents --concurrency 2 --json eval-<draft>-<repair>.json` per pair; keep the setting with the lowest median wall time that holds every runbook gate **and** does not raise the repair-round distribution or lower the first-candidate pass rate against the M0.2 baseline. A higher repair rate can cancel the saving (a render Repair costs 35–50 s). Review covers by hand. Research has no eval: compare 10 fixed briefs side by side before and after.

**Expected (production runs Luna):** est. 40–120 s off each draft, 20–40 s off each Repair; research turns 30–60% shorter.

### M3. Reliability foundations (the tail, and the prerequisites for M4)

**M3.1 — App-owned LLM retry loop (A7 + backlog 4).** S–M. Depends on M2.1.
- Build the client with `retryConfig: { strategy: 'none' }`.
- In `OpenRouterStrategy.send`, per try: `signal = AbortSignal.any([AbortSignal.timeout(perTryMs), opts.signal])`, passed as `chat.send({ chatRequest }, { signal })` (an explicit signal takes precedence and also bounds the body read). On a retryable `LLMError`, sleep `Retry-After` if present, else full jitter `rand(0, min(cap, base·2^n))`; stop when tries run out or `now + sleep > deadlineAt`.
- `toLLMError` (`llm/errors/llm.error.ts:28-31`): retry a raw `TimeoutError`; for `ResponseValidationError` with `statusCode 200`, parse the body's `error.code` and classify it (unparseable = retryable); retry 429; keep a caller's `AbortError` terminal. Add `retryAfterMs?` to `LLMError`.
- Keys: `OPENROUTER_TIMEOUT_MS` (default 240000, must exceed the slowest healthy draft, 212 s measured), `OPENROUTER_MAX_ATTEMPTS` (3), `OPENROUTER_RETRY_BASE_MS` (1000), `OPENROUTER_RETRY_MAX_DELAY_MS` (15000), `OPENROUTER_RETRY_BUDGET_MS` (45000). Per call site: research turns ~45 s; DOCUMENT draft and Repair `min(timeout, deadline.remainingMs())`, which adds `remainingMs()` to `RunDeadline` (`engine/run-deadline.ts`, `workflow.types.ts:304-306`).
- Budget vs deadline (as built, #220): `OPENROUTER_RETRY_BUDGET_MS` bounds the total time one call sleeps between tries, `Retry-After` included; a sleep that would pass it ends the call with its last (still retryable) error, so the job's own retry decides. `deadlineAt` is separate and optional: it cuts each try's timeout to the time left and stops a retry whose sleep would end past it. Calls without one (POST/POLL generation, research) are bounded by tries × timeout + budget. DOCUMENT drafts and Repairs fix `deadlineAt` once from `remainingMs()`, so the envelope repair turn shares it.
- Rollback: `OPENROUTER_MAX_ATTEMPTS=1` and a large timeout (still no 1 h spin).
- Effect: a 429 or a 502 no longer replays the whole job (research, draft, render); a hung call ends.

**M3.2 — R5 research resume.** S. Independent.
- `RunRecordHandle.readResearchContext()` (projected `findById`). In `researchStep`, if a saved context exists: emit `sourcesFound`, re-record the saved `{ usdCost, searches }` on the meter (so a retried run bills like an unretried one; decided 2026-10-18), return it.
- Fix the false claim in `agent-loop-and-research-agent-design.md:265`.

**M3.3 — Graceful worker shutdown and stalled-job failure.** S + M. Must ship before M4.
- Extract `workers/worker-shutdown.ts`. On `SIGTERM`/`SIGINT` (once): `Promise.allSettled(workers.map(w => w.close()))` for all workers → await in-flight `onFailed` promises (`ArtifactRunProcessor.idle()`, tracked in a set) → `app.close()` → `exit(0)`; a `WORKER_SHUTDOWN_TIMEOUT_MS` timer (default 120000) forces `exit(1)`. Do **not** use Nest `enableShutdownHooks`: `onModuleDestroy` closes Redis and Mongo before jobs finish.
- Stalled failures: a `QueueEvents` listener for `failed` with `failedReason === 'job stalled more than allowable limit'` calls the existing idempotent `handleTerminalFailure` (fail Attempt, fail run, emit `run.failed`). Then set `maxStalledCount: 2` and `stalledInterval: 10000` on the workflow workers.
  - As built (bullmq 5.66.5): the stalled checker only marks the job (`defa`) and puts it back in wait; the next worker to pick it up fails it with an `UnrecoverableError` of that reason, so its own `failed` event fires too. Both reports reach `onFailed`, and `handleTerminalFailure` is made idempotent by `RunRecordHandle.fail` writing only while the run is `RUNNING` (`'ALREADY_ENDED'` otherwise): the second report emits nothing. The user sees the temporary-failure reason, not BullMQ's text.
- Railway: the drain window is the service variable `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` (time between `SIGTERM` and `SIGKILL`; reported defaults are 0–3 s, so today a deploy kills running jobs almost at once). Set it to 130 on the worker, ≥ `WORKER_SHUTDOWN_TIMEOUT_MS` / 1000 + 10. The worker must be started with `node` directly (the Dockerfile does), since a package-manager wrapper can swallow `SIGTERM`. A DOCUMENT attempt can run 6 min, so the longest ones will still be force-stopped and resume from the `acceptedCandidate` checkpoint.

**M3.4 — Entitlement resolved once (A4, backlog 7 + 8).** S–M.
- `FeatureGatingService.resolveEntitlement(userId): Promise<Entitlement>` with `{ tier, source, subscriptionStatus, period }`, from **one** subscription read; the period comes from the same document. When the tier document is missing, use the default tier **and** the default period, consistently.
- In-process tier cache (tiers are written only by the seed script), TTL `FEATURE_TIER_CACHE_TTL_MS` (60000; `0` disables). Never cache the subscription or a null default.
- `assertBalance(userId, ent?)` and `assertResearchAccess(userId, ent?)` reuse a passed entitlement; new `assertLaunch(userId, { withResearch })`; `debit(userId, credits, period?)`.
- Launch: 4–6 gating reads → 3 (1 subscription, 1 usages, tier cached). Worker: `Promise.all([resolveEntitlement, readDocumentDiagnostics])`, research check with 0 reads, `RunCreditMeter` built with the entitlement; 6–8 reads → 2. Keep the worker's balance check (the wallet can drain while the job waits).
- Old signatures keep working (`ent?` optional), so `SubscriptionAccessGuard` and the dashboard migrate at leisure.

**M3.5 — Mongo pool from config (backlog 10).** XS. `MONGO_MAX_POOL_SIZE` (10), `MONGO_MIN_POOL_SIZE` (2), validated at boot via a shared `readIntEnv` helper (new `common/env.ts`; the app has no env schema today). Extract `mongoOptionsFrom(config)` for a spec. Rule: worker pool ≥ total worker concurrency + 10.

### M4. Throughput under load

Ship only when M3.1, M3.3 and M3.5 are in production. With Browserless Free (2 sessions), document throughput tops out at about 2 renders at a time; POST and POLL are not limited by it.

**M4.1 — Split queues and concurrency from env (backlog 1 + 2).** S.
- `workflow.constants.ts`: keep `QUEUE_NAME = 'workflow'` for POST/POLL, add `DOCUMENT_QUEUE_NAME = 'workflow-document'`, `queueNameFor(type)`. `WorkflowQueue.addArtifactRunJob` routes by `input.type`; both queues close on destroy.
- `workflow.worker.ts`: two Workers on the same processor and `failed` listener, `concurrency` from `WORKFLOW_TEXT_CONCURRENCY` and `WORKFLOW_DOCUMENT_CONCURRENCY` (code defaults 1; start production at 10 and 2; 2 matches Browserless Free, see M4.2), plus `WORKFLOW_LOCK_DURATION_MS` (30000). Extract `workflowWorkerOptions(env)` for a spec.
- Deploy the worker first (it drains both queues), then the API. Legacy DOCUMENT jobs already in `workflow` are processed by the text worker, since the processor is type-agnostic.
- Checked safe at C > 1: no per-run mutable state in `AgentRunnerService`, `OpenRouterStrategy`, the renderer, or `ArtifactRunProcessor` (its map is per run id).

**M4.2 — Browserless slot semaphore (backlog 3).** M. With M4.1.
- `document-render/render-slots.ts`: Redis ZSET `browserless:slots` of lease tokens scored by expiry; atomic Lua acquire using Redis `TIME` (reap expired, check `ZCARD < limit`, `ZADD`); release `ZREM` own token.
- Lease TTL = `RENDER_SESSION_DEADLINE_MS + BROWSERLESS_SESSION_GRACE_MS + 5 s` (75 s), so a crashed worker's lease expires right after Browserless frees the session; no heartbeat.
- Acquire in `DocumentRendererService.render` immediately before `renderDocumentSession` (before `connect` and the session clock); release in `finally`. The 2 s retry sleep and Repairs are outside the lease.
- Wait with jittered polling (250 ms → 1 s) up to `min(BROWSERLESS_SLOT_WAIT_MAX_MS = 120000, deadline.remainingMs() − 20000)`; timeout → `RenderSlotUnavailableError` → transient `render.unavailable`, no attempt recorded, nothing billed. Record `slotWaitMs` on `renderAttempts`.
- `BROWSERLESS_MAX_CONCURRENT_SESSIONS` = the plan's limit; unset/0 disables. Redis errors fail open.
- **Current plan: Browserless Free** (confirmed 2026-10-18): 2 concurrent browsers, 1,000 units a month (1 unit = up to 30 s of one connection; a 15 s session is 1 unit, a session past 30 s is 2), 2 min max session (above our 60 s deadline, so no change there), and requests are rejected once units run out. So set `BROWSERLESS_MAX_CONCURRENT_SESSIONS=2` and start `WORKFLOW_DOCUMENT_CONCURRENCY` at **2**, not 4: a third document would only wait for a slot. At 1–4 sessions per run (about 1.5 on average at a 37% Repair rate) the free units cover roughly 600–700 documents a month, local evals included. Alert on unit usage; when it runs out, every render fails as `render.unavailable`. Prototyping ($35/mo: 5 concurrent, 20k units, 15 min sessions) is the next step once documents exceed that or users wait on slots (`slotWaitMs` p90 > 10 s).

**M4.3 — `artifacts` index (backlog 13).** XS. `ArtifactSchema.index({ user: 1, updatedAt: -1, _id: -1 })`. Build it first with a one-off script (pattern: `scripts/migrate-run-candidate-sources.ts`) or in Atlas, then deploy the schema line.

**M4.4 — Per-user in-flight cap (backlog 11).** M. Ships disabled.
- Redis ZSET `workflow:inflight:{userId}` of run ids scored by lease expiry; Lua reserve after `assertLaunch`, before any write (pre-generate the run `_id` for this). Release on enqueue failure, on success, on terminal failure, and in the M3.3 stalled handler; the worker refreshes the lease each attempt.
- `MAX_INFLIGHT_RUNS_PER_USER` (0 = off), `RUN_INFLIGHT_LEASE_SECONDS` (1800). Over the cap: HTTP 429 `{ code: 'run.too_many_in_flight', limit, message }`; the web already shows `reason.message`.
- Docs: `docs/api/artifacts.md` error tables, `docs/api/README.md` throttle list; a user-visible limit, so a product ledger note.

**Exit:** a staging load test of N concurrent launches (start at 50: 20 POST, 10 POLL, 20 DOCUMENT) with the real Browserless plan: zero `render.unavailable`, zero runs stuck `RUNNING`, POLL `queueWaitMs` p90 < 5 s while documents run, Mongo pool wait ~0. Then raise concurrency step by step.

### M5. Fewer and cheaper Repairs

**M5.1 — D3 targeted prompt lines.** S + eval.
- Design System fragment (`design-system/prompt-fragment.ts`):
  - PAGE (after line 55): a computed line budget, "At {px}px/{lh} body text the usable box holds about {N} lines, headings and gaps included. Fill at most 80% of that; cut words rather than shrink type." Targets `page.safeArea` (text past the bottom edge, 4 of the 10 post-#189 render Repairs).
  - ICONS (line 78): "Give every svg an explicit colour, e.g. `.page svg { color: var(--ds-{icons.colors[0]}); }`. Never let an icon inherit the text colour." Targets `icons.colors`.
- Generic FRAME section (`artifact-generation.prompts.ts`, after line 138):
  - Text sits on a solid palette token, never on `color-mix()`, translucency or opacity (`palette.pairings`: 37 of 65 violations were mixed colours).
  - Decorative text (oversized numerals, letters) is still text; never place other text over it (`render.overlap`: all hits were giant glyphs).
  - Markers stay inside their item; no negative offsets past the wrapper (`page.safeArea` left-edge hits).
- Gate: eval first-candidate pass rate up and repair rounds down against the M2 baseline; no other gate worse.
- Tests: `prompt-fragment.spec.ts` (line budget per seed, icon line), `artifact-generation.prompts.spec.ts`.

**M5.2 — D2 patch-based Repairs.** M. After M5.1 and M1.3.
- Repair answer schema: `{ edits: {find, replace}[] (≤40) | null, html: string | null }`, exactly one non-null. Prefer `edits`; `html` for structural codes (`envelope.body`, `page.pages`, `composition.pageRoles`).
- New pure `document-source/candidate-patch.ts` `applyEdits(candidate, edits)`: exact bytes (CRLF→LF only), each `find` matches **exactly once**, no overlapping ranges, applied by offset last-to-first, atomic, empty `edits` is a failure.
- On failure: one warm follow-up in the same round listing the problems, answered with `{ html }`. Billed but not counted against `DOCUMENT_REPAIR_BUDGET`; cap one fallback per job attempt.
- Model-authored edits are not sanitising: spec §4.4 "reject only, never sanitize" holds because the app changes nothing itself and `check()` re-runs on the result. Amend §7.2, §7.5 and the CONTEXT.md "Repair" entry ("produces a revised Candidate Source, as edits or in full").
- Switch: module constant `DOCUMENT_REPAIR_MODE: 'full' | 'patch'` (deploy-switched, per spec §10). Record `repairs: [{ kind, mode, edits, fallback }]` in diagnostics. Go/no-go: fallback rate < 20% in the eval.

### M6. Render network

Decide from M0.2 production `phaseMs`.

**M6.1 — D6 fewer CDP round trips.** S. Do regardless; worth ~0 once co-located but costs nothing.
- Setup: attach the request listener, then `Promise.all([setJavaScriptEnabled(false), setRequestInterception(true), emulateMediaType('print'), setViewport(...), page.createCDPSession()])`.
- Font pass: pipeline `DOM.enable`, `CSS.enable`, `DOM.getDocument`; don't await `cdp.detach()`.
- PDF: `page.pdf({ ..., waitForFonts: false })` at minimum (the probe already awaited `document.fonts.ready`), or `Page.printToPDF` with `transferMode: 'ReturnAsBase64'` on the existing CDP session (inch units: px/96).
- Don't await `browser.disconnect()`.
- ~12 round trips, est. 4–5 s per remote session. `render-session.spec.ts:107-150` changes; `bun run test:render` is required (page count and geometry).

**M6.2 — D5 co-locate Browserless.** Infra. The Free plan offers San Francisco, London and Amsterdam endpoints; pick the one nearest the Railway region before anything else (a config change). If production healthy sessions are > 5 s: a Browserless region next to Railway, or a self-hosted container on Railway's private network (check the image licence). Then `BROWSERLESS_MAX_CONCURRENT_SESSIONS` = the container's `CONCURRENT`. Est. 8–12 s per session. Rollback: `BROWSERLESS_URL`.

**M6.3 — D7 inline fonts.** M. Only if the load phase is still > 0.5 s after M6.1/M6.2.
- Worker-only `FontInlinerService.inlineCss(definition, candidate)`: fetch the css2 stylesheet with a Chrome User-Agent, keep faces whose `unicode-range` meets the text (always `latin` + `latin-ext`), inline woff2 as `data:font/woff2;base64`. Per-process cache of promises (evict rejections); about 2.3 MB across all six systems.
- `assemble(definition, candidate, fontCss?)` stays pure: `<style>` replaces the `<link>` when given; fetch failure falls back to the `<link>`.
- The request filter must skip `data:font/` before its refusal branch, or every render becomes `render.egress` (Puppeteer emits `request` for data URLs and `abort()` is a no-op on them).
- Amend spec §4.5 item 2, §5.1 step 2, §10; CONTEXT.md "Document Source".

### M7. Structural and perceived-speed changes

**M7.1 — R3 (part 2) and R2.** S + check. `TAVILY_SEARCH_DEPTH=basic` after a side-by-side on 10 briefs. R2 only if R4 slips: prompt "issue all queries (≤5) in your first turn, then answer" (`research.prompts.ts:16-17`, tool description `search-web.tool.ts:22-25`), `RESEARCH_MAX_STEPS=2`.

**M7.2 — R4 snippet research.** M. `RESEARCH_MODE=agent|snippets` (default `agent`), switched inside `AgentRunnerService.research()`.
- `snippets`: one `RESEARCH_MODEL` call at the lowest supported effort (`none` on Luna) returning `{ queries: string[1..4] }` → `Promise.all` Tavily searches (each success still calls `hooks.onToolCall`, preserving the `web_search` charge) → normalise URLs, dedupe, interleave by query, cap at `RESEARCH_MAX_SNIPPETS` (10) × `RESEARCH_SNIPPET_CHARS` (600) → `findings` as numbered `[n] Title (url)` blocks, `mode: 'snippets'`.
- Same `ResearchResult` shape, so `researchContext`, refine reuse (`getLatestCompletedResearch`) and storage are unchanged. `buildGenerationUserPrompt` (`:205-212`) labels the section "RESEARCH SNIPPETS (raw web excerpts; use only facts they state)" and skips it when empty.
- Needs a small research A/B script (POST and DOCUMENT with research on, fixed briefs). Est. research 20–45 s → 3–5 s.
- Amend `agent-loop-and-research-agent-design.md` §5.

**M7.3 — P1 stream POST/POLL commentary.** M–L. Depends on M3.1.
- `CompletionOptions.onTextDelta` switches `send()` to `stream: true` (the SDK yields `ChatStreamChunk`s with `delta.content`, `finishReason`, `usage`, and mid-stream `error`). Same per-try timeout; no short idle timer, since a reasoning model streams nothing while it thinks.
- Hand-rolled `extractStringField(buf, 'commentary')` (~40 lines; no partial-JSON library in deps). Strict output emits keys in schema order and `commentary` is first.
- `generateStep` throttles to one `step.progress { step: 'GENERATE', phase: 'writing', partial: { commentary } }` per 250–300 ms when the text grew; `phase: 'rewrite'` resets before a Zod repair.
- Web: `RunProgressEvent.partial?`, `RunState.draftCommentary?`, a pre-wrap preview bubble until `onArtifactReady` swaps in the result; clear it on `rewrite` and on a retrying `step.failed`.
- Switch: `STREAM_POST_COMMENTARY` (false). Verify streaming + `json_schema` + `requireParameters` on the production model.
- Docs: `docs/api/runs.md:74-102`, `sse-progress-contract-design.md` §3; a product ledger entry (user-visible).

**M7.4 — P3 faster model for POLL/POST.** S + eval. `POLL_GENERATION_MODEL`, `POST_GENERATION_MODEL`, falling back to `GENERATION_MODEL`. Needs a text eval script modelled on `scripts/eval-documents` (N briefs per type, outputs side by side, latency and tokens). Built as `bun run eval:text` ([text-eval-runbook.md](text-eval-runbook.md)); choosing the models is a human step.

**M7.5 — A5 content in `run.completed`.** M, low priority (0.1–0.25 s). For POST/POLL only, `run.completed` carries `content` (and `title` on INITIAL); the web appends it without the GET and falls back to the GET on replay, snapshot, mismatch or error. Verify `promoteVersion` stores content unchanged. Docs: `docs/api/runs.md:48,~170`, `sse-progress-contract-design.md:146,182`, `docs/api/artifacts.md:325`.

### Not doing

| Item | Why |
| --- | --- |
| D10 drop the JSON envelope | 1–2% of draft time; contract change across checker, assembly, refine and eval. Revisit only if drafts stop reasoning. |
| Pre-generated `_id`s to batch inserts | One round trip; unsafe for REFINE. |
| BullMQ priorities / Pro groups | Priority doesn't reserve capacity; groups are Pro only. Separate queues instead. |
| Multiplexed SSE `XREAD` (backlog 9) | After M4, waits are minutes, not hours. Add a gauge of open live streams now; build only if the Redis plan's connection cap gets close. |
| Pre-connecting Browserless during the draft | Bills idle units against a 70 s Browserless timeout. |

## 5. Sequence

```
M0 measure ──► M1 safe wins ─────────────────────────────────────────┐
     │                                                                │
     └──► M2.1 options ──► M2.3 efforts (eval) ──► M5.1 D3 ──► M5.2 D2│
               │                                                      │
               └──► M3.1 retry loop ──► M7.3 P1                       │
                                                                      ▼
M3.2 R5 ─┐                                                     M6 render network
M3.3 shutdown + stalled ─┼──► M4.1 queues + concurrency ──► M4.2 semaphore ──► load test ──► M4.4 cap
M3.4 entitlement ─┤
M3.5 pool ────────┘
M7.1 / M7.2 research, M7.4, M7.5: after M2, in any order
```

Suggested PR order (each one reviewable on its own):

| # | PR | Milestone | Size | Gate |
| --- | --- | --- | --- | --- |
| 1 | LLM usage, latency, queue wait recorded | M0.1 | S | tests |
| 2 | Engine: run.completed before debit; drop setCurrentStep | M1.1 | XS | tests |
| 3 | Parallel R2 uploads; `{html}`-only Repairs | M1.2, M1.3 | XS | tests |
| 4 | Web: open the stream at once; replaceState | M1.4 | S | tests + manual run |
| 5 | Refine reads candidate from Mongo; skip cover on findings | M1.5, M1.6 | S | tests + `test:render` |
| 6 | Tavily timeout/client; content schema constraints; drop duplicate poll options | M1.7, M1.8, M1.9 | S | tests |
| 7 | Per-call reasoning effort, model, session id | M2.1, M2.2 | S | tests (no behaviour change) |
| — | Switch efforts on | M2.3 | env | eval vs baseline |
| 8 | App-owned LLM retry loop + error classification | M3.1 | S–M | tests |
| 9 | Research resume | M3.2 | S | tests |
| 10 | Graceful shutdown + stalled failure handling | M3.3 | S–M | tests + kill test locally |
| 11 | Entitlement once + tier cache; Mongo pool config | M3.4, M3.5 | S–M | tests |
| 12 | Split queues + concurrency | M4.1 | S | tests; deploy worker first |
| 13 | Browserless semaphore | M4.2 | M | tests + load test |
| 14 | Artifacts index (script, then schema) | M4.3 | XS | — |
| 15 | Targeted prompt lines | M5.1 | S | eval |
| 16 | CDP round trips | M6.1 | S | `test:render` |
| 17 | Patch Repairs (`DOCUMENT_REPAIR_MODE`) | M5.2 | M | eval, fallback < 20% |
| 18+ | Snippet research, streaming commentary, model split, inline content, in-flight cap, inline fonts | M7, M4.4, M6.3 | M each | per item |

## 6. Configuration added

Every key defaults to today's behaviour. Each needs a `.env.example` entry and a line in `apps/api/AGENTS.md`; worker keys also go in `docs/monorepo.md` (Railway).

| Key | Default | Process | Milestone |
| --- | --- | --- | --- |
| `RESEARCH_REASONING_EFFORT`, `GENERATION_REASONING_EFFORT`, `DOCUMENT_DRAFT_REASONING_EFFORT`, `DOCUMENT_REPAIR_REASONING_EFFORT` | unset | worker | M2 |
| `OPENROUTER_TIMEOUT_MS`, `OPENROUTER_MAX_ATTEMPTS`, `OPENROUTER_RETRY_BASE_MS`, `OPENROUTER_RETRY_MAX_DELAY_MS`, `OPENROUTER_RETRY_BUDGET_MS` | 240000, 3, 1000, 15000, 45000 | worker | M3.1 |
| `TAVILY_TIMEOUT_S`, `TAVILY_SEARCH_DEPTH` | 10, `advanced` | worker | M1.7 |
| `WORKER_SHUTDOWN_TIMEOUT_MS` | 120000 | worker | M3.3 |
| `FEATURE_TIER_CACHE_TTL_MS` | 60000 | both | M3.4 |
| `MONGO_MAX_POOL_SIZE`, `MONGO_MIN_POOL_SIZE` | 10, 2 | both | M3.5 |
| `WORKFLOW_TEXT_CONCURRENCY`, `WORKFLOW_DOCUMENT_CONCURRENCY`, `WORKFLOW_LOCK_DURATION_MS` | 1, 1, 30000 | worker | M4.1 |
| `BROWSERLESS_MAX_CONCURRENT_SESSIONS`, `BROWSERLESS_SLOT_WAIT_MAX_MS` | unset (off), 120000 | worker | M4.2 |
| `MAX_INFLIGHT_RUNS_PER_USER`, `RUN_INFLIGHT_LEASE_SECONDS` | 0 (off), 1800 | api + worker | M4.4 |
| `RESEARCH_MODE`, `RESEARCH_MAX_SNIPPETS`, `RESEARCH_SNIPPET_CHARS` | `agent`, 10, 600 | worker | M7.2 |
| `STREAM_POST_COMMENTARY` | false | worker | M7.3 |
| `POLL_GENERATION_MODEL`, `POST_GENERATION_MODEL` | `GENERATION_MODEL` | worker | M7.4 |

Module constant (deploy-switched, spec §10): `DOCUMENT_REPAIR_MODE` (`'full'`).

## 7. Measurement and success criteria

Fill the "Baseline" column in M0.2; re-measure after each milestone.

| Metric | Source | Baseline | Target |
| --- | --- | --- | --- |
| DOCUMENT draft wall time p50 / p90 | `documentDiagnostics.modelTurns` | local 96 s / 173 s | est. ≤ 60 s / ≤ 100 s |
| Reasoning share of DOCUMENT output tokens | same | unknown (M0.1) | < 40% on a reasoning model |
| Runs with ≥ 1 Repair | `repairRounds` | local 37% | < 25% |
| Repair turn p50 | `modelTurns` | local ~40 s | < 20 s |
| Render session p50 (healthy) | `renderAttempts.phaseMs` | local remote 11–15 s | < 5 s |
| Research step p50 | step events / `llmUsage` | est. 20–45 s | < 10 s |
| POST/POLL GENERATE p50 | `llmUsage` | unknown | track; first text < 2 s with P1 |
| Queue wait p90 (text / document) | `queueWaitMs` | unknown | < 5 s / < 60 s at peak |
| Runs stuck `RUNNING` > 30 min | Mongo query | unknown | 0 |
| `render.unavailable` rate | run failures | local 1/53 | 0 under load test |

Quality guards on every eval-gated change: the runbook gates (≤1 failing run, 0 `document.truncated`, 0 `render.egress`, slowest ≤ 4 min, cost spread ≤ 3×), first-candidate pass rate not lower, and a human look at covers.

## 8. Tests per change

| Change | Existing specs to update | New specs |
| --- | --- | --- |
| M0.1 | `openrouter.strategy.spec.ts`, `agent-runner.service.spec.ts`, `document-run-diagnostics.spec.ts`, `workflow-run.service.spec.ts` | — |
| M1.1 | `workflow.engine.spec.ts` (`:199-206` current-step test removed; add "emits run.completed before the debit", "still emits when commit rejects"), `workflow-run.service.spec.ts`, handler and integration mocks | — |
| M1.2 | `render-pdf.step.spec.ts` | cover failure while PDF PUT pending |
| M1.3 | `agent-runner.service.spec.ts` | — |
| M1.4 | — | `useArtifactRun.test.tsx` (harness reused by M7.3, M7.5) |
| M1.5 | `resolve-input.step.spec.ts:270-330` | Mongo hit / miss / mismatch / error, parallel reads |
| M1.6 | `render-session.spec.ts`, `document-renderer.service.spec.ts` | — |
| M1.7, M7.1 | `search-web.tool.spec.ts:19-38,74-85` | — |
| M1.8 | `artifact-content.schema.spec.ts`, `openrouter.strategy.spec.ts:200-322` | — |
| M1.9 | `dedupePollOptions` spec (case/whitespace duplicates removed, first kept; < 2 left is unchanged; non-POLL untouched); `agent-runner.service.spec.ts`: a draft with a repeated option succeeds with no repair call | — |
| M2 | `agent-runner.service.spec.ts` (effort and model per call site), `openrouter.strategy.spec.ts` | env parsing |
| M3.1 | `llm.error.spec.ts:38-95`, `openrouter.strategy.spec.ts:566-592` | retry then success, `Retry-After`, budget exhausted, abort not retried |
| M3.2 | `research.step.spec.ts` | — |
| M3.3 | `artifact-run.worker.handler.spec.ts` | `worker-shutdown.spec.ts`, stalled-failure handler |
| M3.4 | `feature-gating.service.spec.ts`, `credit-meter.service.spec.ts`, `run-credit-meter.spec.ts`, `artifact-generation.service.spec.ts`, handler spec | tier cache (fake timers), one-read entitlement |
| M3.5, M4.1 | `workflow.queue.spec.ts` | `common/env.spec.ts`, `mongo-options.spec.ts`, `workflow-worker.options.spec.ts` |
| M4.2 | `document-renderer.service.spec.ts`, `render-pdf.step.spec.ts`, `run-deadline.spec.ts` | `render-slots.spec.ts` |
| M4.4 | `artifact-generation.service.spec.ts`, handler spec | `inflight-limiter.service.spec.ts` |
| M5.1 | `prompt-fragment.spec.ts`, `artifact-generation.prompts.spec.ts` | — |
| M5.2 | `agent-runner.service.spec.ts`, `render-pdf.step.spec.ts:295-465`, `generate.step.spec.ts`, `document-generation.integration.spec.ts` | `candidate-patch.spec.ts` |
| M6.1 | `render-session.spec.ts:107-150` | — (`test:render` required) |
| M6.3 | `assemble.spec.ts`, `render-session.spec.ts`, `seed-conformance.spec.ts` | `font-inliner.service.spec.ts` |
| M7.2 | `agent-runner.service.spec.ts` research suite, `artifact-generation.prompts.spec.ts` | — |
| M7.3 | `generate.step.spec.ts`, `agent-runner.service.spec.ts`, strategy spec | `extract-string-field.spec.ts`, throttle |
| M7.5 | `workflow.engine.spec.ts:358` | web inline-path test |

Every PR: `bun run check`; lint only touched files with `bunx eslint <files>` from the app directory.

## 9. Docs to amend as items land

| Doc | Items |
| --- | --- |
| `docs/document-generation-spec.md` | §11.1 (M0.1, M4.2 `slotWaitMs`, M5.2 repair modes); §7.2, §7.5 (M5.2); §4.5, §5.1 (M6.3); §10 (new constants and env); §7.4 note (M1.5) |
| `CONTEXT.md` | Repair (M5.2), Document Source (M6.3) |
| `docs/api/runs.md`, `docs/sse-progress-contract-design.md` | M7.3 (`partial`, `writing`/`rewrite` phases), M7.5 (`content` on `run.completed`), M3.2 (resume note) |
| `docs/api/artifacts.md`, `docs/api/README.md` | M4.4 (429), M7.5 (refetch optional) |
| `workflow-engine-design.md:171,184`, `sse-progress-contract-design.md:228,257-261`, `artifact-workflow-prd.md:399,1139` | M1.1 (`currentStep` removed) |
| `agent-loop-and-research-agent-design.md` | `:265` (M3.2), §5 (M7.2) |
| `apps/api/AGENTS.md`, `.env.example`, `docs/monorepo.md` | every new key; five worker queues; two workflow queues and deploy order (M4.1); drain window (M3.3) |
| `artifact-generation-latency-audit.md`, `artifact-generation-performance-model.md` | point to §2 of this plan for corrections |
| `packages/product` ledger | M7.3 (streamed posts), M4.4 (in-flight limit) |

## 10. Risks

| Risk | Where | Mitigation |
| --- | --- | --- |
| Lower reasoning effort raises the Repair rate and cancels the saving | M2.3 | eval compares repair rounds and first-candidate pass rate, not only wall time; D3 lands after |
| Effort sent to a model that doesn't support it (404 or 400, or turns reasoning on) | M2 | all keys unset by default; per-model table in §4; boot validation |
| Per-try timeout kills healthy slow drafts | M3.1 | default 240 s > 212 s measured max; `min(timeout, deadline remaining)` for documents |
| Concurrency multiplies retries, restarts and Browserless load | M4 | M3 ships first; semaphore; start at 10/4; load test before raising |
| Deploy order strands DOCUMENT jobs | M4.1 | worker first; a missed order delays, it doesn't lose |
| Patch edits miss (whitespace) and the fallback eats the gain | M5.2 | measured fallback rate; `full` mode stays the default until < 20% |
| Inlined font subsets miss a glyph | M6.3 | always include `latin` + `latin-ext`; `<link>` fallback; `test:render` |
| Streamed draft text is replaced by a Zod repair | M7.3 | `rewrite` phase resets the preview; P2 lowers the miss rate first |
| Snippet research quality drops (no synthesis) | M7.2 | flag, default `agent`; A/B on fixed briefs |
| Stale tier cache after a seed | M3.4 | 60 s TTL; subscription never cached |

## 11. Decisions

Answered 2026-10-18:

1. **Production `GENERATION_MODEL`** is `openai/gpt-6-luna-pro`. M2 is worth est. 40–120 s per document in production. `RESEARCH_MODEL` is the same model, so research turns also reason at `medium` today and M2.3 applies to them.
2. **Browserless plan:** Free (2 concurrent, 1,000 units/month, 2 min sessions). Sizes M4.2: `BROWSERLESS_MAX_CONCURRENT_SESSIONS=2`, `WORKFLOW_DOCUMENT_CONCURRENCY=2`. Region still to check for M6.2.
3. **Research on a retried run:** charge it again (M3.2).
4. **Duplicate POLL options:** drop exact duplicates in code (M1.9).
5. **Railway drain window:** set `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=130` on the worker with M3.3. Slower worker deploys are acceptable (no production traffic yet).
6. **Per-user in-flight cap (M4.4):** build it with M4, shipped off (`MAX_INFLIGHT_RUNS_PER_USER=0`). Turn it on at 3 if M0 `queueWaitMs` shows users waiting behind another user's batch.
