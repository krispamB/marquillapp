# Compat Audit: What Breaks When `PostDraft` Becomes `Post`

> Status: research report for wayfinder map #99, ticket #100.
> Author: generated for Christopher Pam.
> Scope: audit-only. No code changes. Recommends rename-vs-new-collection and
> enumerates every backward-compatibility hazard for a human to weigh.

Charter givens this audit assumes (from map #99):

- **#2** — a new `Post` schema replaces `PostDraft`; a post references **multiple**
  artifacts. "Rename/evolve if viable; backward compatibility must be audited."
- **#3** — the existing workflow engine and `quickPostLinkedin`/`insightPostLinkedin`
  stay **untouched**.
- **#8** — usage gating moves from feature counters to token-backed **credits**.

The single most important structural fact this audit surfaces: **a `PostDraft`'s
Mongo `_id` is used verbatim as the BullMQ `jobId` (or job payload key) across all
three queues, and is embedded in R2 object keys.** Identity is load-bearing far
beyond the document itself.

---

## 0. Resolution (2026-07-08, product owner)

These decisions collapse most of this audit: **this is a product relaunch with no
real existing users yet, so a complete write-over is authorized** — no data
backfill, no `_id` preservation, no coexistence window, no versioned endpoints.

1. **No data to migrate.** `postdrafts` can be dropped and rewritten outright.
   Flush Redis (queues) and R2 on cutover. The *data-migration* hazards below —
   **H1** (in-flight jobs), **H4** (stranded media), **H6** (orphaned R2 objects),
   **H9** (aggregations), **H10** (backfill) — become **moot**. They survive only
   as design notes, not backward-compat risks. §7's new-collection-vs-rename
   question is likewise moot: build the new `posts` + `artifacts` schemas clean.
2. **Legacy engine is absorbed, not preserved.** `quickPostLinkedin` and
   `insightPostLinkedin` fold into the single artifact-build flow as a
   **"research / no research" toggle the user picks before the build starts**
   (research-on ≈ today's insight post; research-off ≈ today's quick post — the two
   `ContentType`s already map exactly onto that split). ⚠️ **This reverses charter
   decision #3** ("the existing engine and `quickPostLinkedin`/`insightPostLinkedin`
   stay untouched") **and the map's out-of-scope line** ("Migrating
   `quickPostLinkedin`/`insightPostLinkedin` onto the new engine"). The old engine
   can now be **deleted**, not just left alone.
3. **No versioned endpoints.** The `api/v1/posts/**` surface is reshaped in place;
   **H5** needs no read-adapter.

**Residual work** (engineering, not compat risk): **H2** (rename the `'PostDraft'`
DI string token in `auth.service`), **H3** (redesign the `type` field), **H7**
(re-home usage triggers → credits per map #8), **H8** (keep the account-disconnect
cancel logic working against the new status model). The rest of this document is
the original audit, retained for the design of the new schema.

---

## 1. Blast radius — everything that reads or writes `PostDraft`

| Location | Access | What it does |
|---|---|---|
| `database/schemas/post-draft.schema.ts` | defines | Schema + `PostDraftStatus` enum. Collection name is **default-pluralized → `postdrafts`** (no explicit `collection:`). |
| `database/database.module.ts:42` | registers | `{ name: PostDraft.name, schema: PostDraftSchema }` in the shared `MongooseModule` (global). |
| `post/post.service.ts` | read+write | The bulk: `createDraft`, `getPosts`, `getPost`, `updateContent`, `deletePost`, `publishOnLinkedIn`, `schedulePost`, `addLinkedinMedia`, `initiate/completeMediaUpload`, `getPostMetrics`. |
| `post/linkedin-media.service.ts` | read+write | Worker-side media processing: looks up post by id, flips `media.$.status`, overwrites `media.$.id` with the LinkedIn URN. |
| `post/post.controller.ts` | HTTP surface | All `api/v1/posts/**` routes (see §6). |
| `agent/agent.service.ts:37,239` | write | `updateDraft(draftId, partial)` — called from the workflow step to persist generated `content`. |
| `workflow/steps/createLinkedinDraft.step.ts:38` | write | Persists `content` via `agentService.updateDraft(_job.id, …)` — **keyed on the BullMQ job id, which _is_ the draft `_id`.** |
| `auth/auth.service.ts:76,603,621` | read+write | On LinkedIn account **disconnect**: finds `status: 'SCHEDULED'` drafts, removes their schedule jobs, resets them to `DRAFT`. Injects the model by the **string token `'PostDraft'`** (not `PostDraft.name`). |
| `workflow/workers/workflow.worker.ts:81-88` | indirect | `post-schedule` worker reads `job.data.postId` and calls `postService.publishOnLinkedIn(user, postId)`. |

No migration framework exists in the repo. No code references the literal
collection name `postdrafts`. There is no explicit index declaration on the schema.

---

## 2. Existing production documents

The live collection is `postdrafts`. Each document carries:

- **Identity** used elsewhere: `_id` (see §3, §4, §6).
- **Refs**: `user`, `connectedAccount`.
- **Legacy-engine coupling**: `type` stores a **workflow name string** — one of
  `quickPostLinkedin` / `insightPostLinkedin` (`ContentType`). Reusing this field
  for new-engine artifact workflows will collide with these values.
- **Content**: `content?`, `stylePreset?`.
- **Embedded media**: `media[]` with a lifecycle `status`
  (`PENDING|UPLOADING|READY|FAILED`) and an `id` that is **rewritten from a local
  UUID to the LinkedIn URN** once `READY`.
- **Workflow scratch**: `youtubeResearch`, `userIntent`, `compressionResult`
  (the latter two are `select('-…')`-excluded from list responses).
- **Publish state**: `channelPostId`, `scheduledAt`, `publishedAt`, plus timestamps.

**Hazard:** any reshape that drops/moves `content`, `media`, or `type` orphans data
in every existing document. A multi-artifact `Post` that pushes `content`/`media`
down into `Artifact` docs is **not a field-compatible rename** — it is a structural
migration. Existing drafts have no artifact rows and would read as empty under new
serialization unless backfilled.

---

## 3. The `post-schedule` queue (in-flight jobs)

Flow: `schedulePost` sets `status=SCHEDULED`, `scheduledAt`, then
`scheduleQueue.addScheduleJob(post._id, userId, delay)` with **`jobId: postId`**
(= the draft `_id`) and `removeOnFail: false`. The worker later reads
`job.data.postId` and calls `publishOnLinkedIn(user, postId)`, which **re-fetches
the draft by `_id`** and publishes it.

Hazards:

- **H1 (Critical) — id coupling.** A delayed job sitting in Redis at cutover holds
  the old draft `_id` in both its `jobId` and `data.postId`. If the new `Post`
  lives in a different collection **with fresh `_id`s**, `publishOnLinkedIn` fails
  the `findById` → the scheduled post silently never publishes (and, with
  `removeOnFail: false`, lingers as a failed job). **Any migration MUST preserve
  `_id`, or the schedule queue must be drained before cutover.**
- Cancellation logic in `deletePost`, `schedulePost` (reschedule), and
  `auth.service` disconnect all call `scheduleQueue.queue.getJob(post._id)`. Same
  id assumption; same breakage if `_id` changes.

---

## 4. The media-upload queue and R2 flow

Two entry paths (`addLinkedinMedia` server-proxied; `initiate`/`completeMediaUpload`
direct-to-R2 presigned) both:

1. Write R2 objects at key **`media-uploads/${postId}/${mediaId}`** — the draft
   `_id` is embedded in the object path.
2. Push a `media-upload` job whose `data.postId` = draft `_id` (jobId is
   `media-upload-${mediaId}`, `attempts: 3`, `removeOnFail: false`).
3. `LinkedinMediaService.processMediaUpload` re-fetches the post by `postId`,
   uploads to LinkedIn, then `updateOne({_id: postId, 'media.id': mediaId}, …)`
   to set the URN and `status: READY`; on exhaustion, marks `FAILED`.

Hazards:

- **H4 (High) — stranded in-flight media.** Items in `UPLOADING` at cutover are
  updated by the worker via the `media.$` positional path on the **old** document
  shape. If `media` moves into `Artifact` docs, the worker's `updateOne` no-ops and
  media sticks in `UPLOADING` forever (`hasMediaUploadInProgress` then blocks
  publish). Note the existing operational caveat: *the worker must be running or
  media never leaves `UPLOADING`.*
- **H6 (Medium) — orphaned R2 objects.** If `_id` changes, both the presigned-URL
  slots (`initiateMediaUpload`) already issued to clients and the worker's
  `getFile`/`deleteFile` calls point at the old `media-uploads/<oldId>/…` prefix.
  Objects orphan; cleanup (`deleteFile`) misses them. Preserve `_id` or re-key +
  reissue.

---

## 5. `scheduled_posts` feature-gating counters

Good news first: **usage is decoupled from `PostDraft` identity.** `Usage` is keyed
on `(user_id, feature, periodStart)` and stores a `count`; it never stores a draft
`_id`. So a rename/new-collection does **not** corrupt existing counters.

But the **trigger points live in `PostService`**:

- `createDraft` → `assertAiDraftQuota` + `incrementAiDraftUsage` (`ai_drafts`).
- `schedulePost` (first-time only, `status !== SCHEDULED`) → `assertScheduledPostQuota`
  + `incrementScheduledPostUsage` (`scheduled_posts`).

Hazards:

- **H7 (Medium).** Counters are **monotonic** — `deletePost` and unscheduling
  (`auth` disconnect resets `SCHEDULED→DRAFT`) never decrement. Any new flow must
  consciously preserve or intentionally change this behavior.
- The new engine + credits system (map #8) must **re-home these trigger points**;
  if the new `Post` creation path forgets them, gating silently stops enforcing.
- `getUsageSummary` (feature-gating.service ~L364) hardcodes `ai_drafts` and
  `scheduled_posts` keys in its response shape — a client contract of its own,
  separate from `posts`.

---

## 6. Client-facing API contracts (`api/v1`)

The `posts` controller (guarded by `ClerkAuthGuard`) is a wide, `_id`-addressed
surface the SPA depends on:

| Route | Client dependency |
|---|---|
| `POST posts/:id/draft` | `:id` = **connectedAccount** id; returns a `workflowId` (= new draft `_id`) the client polls. |
| `GET posts/:id/status` | `:id` = draft `_id` used as the **BullMQ job id**. |
| `GET posts` | returns `data` (lean docs minus `userIntent`/`compressionResult`) + `filters { availableMonths, connectedAccountIds }`. Client reads every field name below. |
| `GET posts/:id` | full draft doc. |
| `PATCH posts/:id` | update `content`. |
| `DELETE posts/:id` | delete. |
| `PUT posts/:id/media`, `POST posts/:id/media/uploads`, `.../uploads/complete` | media flow; responses expose `media[]` entries with `id/type/status/mimeType/sizeBytes`. |
| `POST posts/:id/publish`, `POST posts/:id/schedule` | publish/schedule. |
| `GET posts/metrics/:connectedAccountId` | `{ total, monthly[] }`. |
| `GET posts/linkedin/image/:urn` | LinkedIn image proxy. |

**Fields the frontend is coupled to:** `_id`, `user`, `connectedAccount`, `type`,
`status` (enum `DRAFT|SCHEDULED|PUBLISHED`), `content`, `stylePreset`, `media[]`,
`channelPostId`, `scheduledAt`, `publishedAt`, `createdAt`, `updatedAt`.

**Hazard H5 (High).** A multi-artifact reshape changes both the URL identity
(post `_id` vs artifact `_id`) and the response body (content/media move into
artifacts). Any of: field renames, status-enum changes, or moving `content` out of
the post document breaks the SPA. This needs either a **read-adapter that serves the
legacy shape** during coexistence, or an explicitly versioned endpoint. The
client-side SSE/library contract is already flagged "Not yet specified" in the map;
this audit adds that the **existing** `posts` contract must keep working until the
frontend migrates.

---

## 7. Recommendation: new collection, not in-place rename

**Recommendation: introduce new `posts` + `artifacts` collections; do NOT rename
`postdrafts` in place. Backfill with `_id` preserved. Run a coexistence window.**

Rationale:

1. **It isn't a rename — it's a reshape.** Multi-artifact `Post` moves `content`
   and `media` out of the document. A `@Schema({ collection: 'postdrafts' })` alias
   on a `Post` class would let new code read old rows, but the shape mismatch
   (no artifact refs, `media` in the wrong place) makes reads/serialization
   inconsistent and forces defensive branching everywhere. Clean separation +
   backfill is less error-prone.
2. **Two writers during the window.** Charter #3 keeps the legacy engine and its
   `quickPostLinkedin`/`insightPostLinkedin` workflows untouched — and those write
   `PostDraft` today. So `postdrafts` **cannot simply vanish** at cutover unless
   the legacy flow is also migrated (which #3 says it is not). Coexistence with two
   collections is the honest model. **→ This is the #1 decision for the human: does
   the legacy generation flow keep producing `PostDraft`s (argues for coexistence),
   or is it repointed at `Post` (contradicts charter #3)?**
3. **Identity preservation is mandatory regardless.** Because `_id` is the BullMQ
   job key (§3, §4) and the R2 key prefix, the backfill **must copy `_id`
   verbatim** so any in-flight jobs at cutover still resolve. Fresh `_id`s = silent
   loss of scheduled publishes and stranded media.

Migration/cutover sketch (for the eventual build effort, not this ticket):

- Write a one-time backfill: `postdrafts` → `posts` (+ derived `artifacts`),
  copying `_id`; map `content`/`media`/`type` into the new shape.
- **Drain or let settle** the `post-schedule` and `media-upload` queues before
  flipping the publish/worker path (avoids the H1/H4 id-resolution gap).
- Serve the legacy `posts` API shape via a read-adapter until the SPA migrates.
- Keep `postdrafts` read-only post-cutover as a rollback safety net; delete only
  after the coexistence window closes.

---

## 8. Backward-compatibility hazard register

Ranked most-severe first. "Preserve `_id`" resolves several at once.

| # | Sev | Hazard | Trigger | Mitigation |
|---|---|---|---|---|
| H1 | **Critical** | Scheduled-publish jobs key on draft `_id` (`jobId` + `data.postId`). | Any migration that changes `_id`, or a collection swap without draining. | Preserve `_id` in backfill; drain `post-schedule` queue before cutover. |
| H2 | **Critical** | `auth.service.ts:76` injects the model by the **string token `'PostDraft'`**, not `PostDraft.name`. | Renaming the class + updating `database.module` without updating this string → Nest DI fails at boot (fails loud, but blocks startup). | Grep for the string token; update in lockstep, or register both tokens during coexistence. |
| H3 | High | `type` field stores a **legacy workflow name** (`quickPostLinkedin`/`insightPostLinkedin`). | New-engine artifact workflows reusing `type` collide with old values; `getPosts`/`getPostMetrics` aggregate across both. | New discriminator field (e.g. `engine`/`artifactType`); leave `type` for legacy rows. |
| H4 | High | Embedded `media[]` lifecycle; worker mutates via `media.$` positional path; `id` overwritten with URN. | `media` moves into `Artifact`; in-flight `UPLOADING` items stranded → publish permanently blocked. | Drain `media-upload` queue before cutover; migrate media→artifact with status carried over. |
| H5 | High | `posts` API response shape + `_id`-addressed routes. | Reshape renames fields / moves `content` out / changes `status` enum. | Read-adapter serving legacy shape, or versioned endpoints, until SPA migrates. |
| H6 | Medium | R2 keys `media-uploads/${draftId}/${mediaId}` + already-issued presigned URLs. | `_id` change orphans objects; worker `getFile`/`deleteFile` miss them. | Preserve `_id`, or re-key + reissue presigned slots. |
| H7 | Medium | `ai_drafts`/`scheduled_posts` counters incremented only in `PostService`; monotonic (no decrement on delete/unschedule). | New `Post` creation path forgets to re-home triggers → gating silently off. | Re-home triggers (or replace with credits per #8) as an explicit migration task; decide decrement semantics. |
| H8 | Medium | Account-disconnect safety (`auth.service`) queries `status: 'SCHEDULED'` and cancels jobs. | New status model / field name → query no-ops → posts publish to a **disconnected** account. | Keep a compatible status query; add a regression test for disconnect→cancel. |
| H9 | Low | Aggregations: `getPosts` `availableMonths`/`distinct(connectedAccount)`, `getPostMetrics`. | Collection split without re-pointing → months/metrics wrong or empty. | Re-point aggregations at `posts`; verify counts across coexistence. |
| H10 | Low | No migration framework; no explicit collection name; global `MongooseModule` registration. | Backfill is greenfield; two-writer window is operationally fiddly. | Add a scripted, idempotent, `_id`-preserving backfill; document the coexistence runbook. |

---

## 9. Open decisions handed to the human

> **Resolved 2026-07-08 — see §0 Resolution at the top.** Complete write-over
> (relaunch, no users); legacy engine absorbed as a research toggle; no versioned
> endpoints. Retained below for context.

1. **Legacy flow fate (blocks the migration model).** Does
   `quickPostLinkedin`/`insightPostLinkedin` keep writing `PostDraft` (→ true
   coexistence, two collections) or get repointed at `Post` (→ contradicts charter
   #3)? Everything in §7 hinges on this.
2. **`_id` preservation** is treated here as mandatory — confirm no requirement
   forces fresh ids.
3. **API coexistence strategy**: read-adapter vs versioned endpoints for the SPA.
4. **Counter → credit cutover** (#8): are historical `ai_drafts`/`scheduled_posts`
   counts discarded at the credit switch, or mapped forward?
