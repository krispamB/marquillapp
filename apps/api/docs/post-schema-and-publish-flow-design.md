# Post Schema & Publish Flow — Design

> Status: design spec for wayfinder map #99, ticket #106 (grilling outcome).
> Author: generated for Christopher Pam. Decisions settled 2026-07-09.
> Blocked by #100 (compat audit — resolved as a clean write-over) and #101 (LinkedIn
> poll/document API research); both docs land in `docs/`.
> Supersedes `src/database/schemas/post-draft.schema.ts` and the `PostDraft`-coupled
> half of `src/post/post.service.ts`.

Feeds the final spec assembly (#110). Consumes the `Artifact` library (#102), the
LinkedIn publish facts (#101), and the credit counters (#105). Interlocking tickets are
referenced inline.

## Framing (charter-derived givens)

- **Charter #1 / #102:** content lives as an **`Artifact`** (a user-owned library entity,
  account-agnostic) until the user chooses to post it. A `Post` *references* artifacts; it
  does not hold content.
- **Charter #2:** a `Post` references **multiple** artifacts (leaves room for a future
  image artifact accompanying text). But **#101 §4:** a LinkedIn post carries **commentary
  + at most one mutually-exclusive content object** (poll *xor* document *xor* image/media).
  So the multi-ref array is real in the schema but **publish-composition enforces LinkedIn's
  one-content-object rule** — for v1 (artifact types POST/POLL/DOCUMENT, image is future) a
  post binds **exactly one** artifact.
- **Clean write-over (#100 §0):** relaunch, no users. Drop `postdrafts`, build `posts`
  clean — no backfill, no `_id` preservation, no coexistence window, no versioned
  endpoints. The compat audit's data-migration hazards (H1/H4/H6/H9/H10) are moot; its
  *engineering residue* (H2/H3/H7/H8) is addressed in §7.

---

## 1. The core decision: a Post is a **publish record**, not a draft

In the `PostDraft` world the draft *was* the content (embedded `content`/`media`) and moved
`DRAFT → SCHEDULED → PUBLISHED`. In the artifact world the **artifact is the draft** — it
lives `READY` in the library (#102). So a `Post` is created **only when the user acts to
publish or schedule**; there is no `DRAFT` post stage.

This collapses the status enum to three states and removes a whole redundant lifecycle:

```
SCHEDULED → PUBLISHED
SCHEDULED → FAILED        (publish attempt errored, or account disconnected — §7)
(immediate publish) → PUBLISHED | FAILED
```

**Rejected — keep a `DRAFT` Post that mirrors the artifact's READY state** (Option A,
`PostDraft`-shaped). It duplicates the artifact library as the drafting surface, reintroduces
the `content`/`media` embedding #102 deliberately moved out, and adds a status with no user
meaning ("a draft of a thing that's already a finished library item").

## 2. `Post` schema

```ts
enum PostStatus { SCHEDULED = 'SCHEDULED', PUBLISHED = 'PUBLISHED', FAILED = 'FAILED' }

@Schema({ timestamps: true })
class Post {
  _id
  user:             ObjectId<User>              // owner, required
  connectedAccount: ObjectId<ConnectedAccount>  // bound HERE (deferred from artifact create, #102 §6)
  artifacts: [{                                  // ordered refs — v1: length 1 (§0 framing)
    artifact: ObjectId<Artifact>,
    version:  number,                            // PINNED at post creation (§4)
  }]
  status:           PostStatus
  scheduledAt?:     Date                         // set when SCHEDULED
  publishedAt?:     Date                         // set when PUBLISHED
  channelPostId?:   string                       // LinkedIn URN from x-restli-id on publish
  failureReason?:   string                       // set when FAILED
  createdAt, updatedAt
}
```

- **`artifacts` pins `{ artifact, version }`, not a bare id** — see §4 (posting captures the
  exact version the user approved, immune to a later refine).
- **`connectedAccount` lives on the Post**, not the artifact — the artifact is
  account-agnostic (#102 §6); account choice is a publish-time decision. Retains the existing
  `PERSON`/`ORGANIZATION` account model and `resolveLinkedinAuthorUrn` unchanged.
- **No embedded `content`/`media`/`type`/`stylePreset`/`youtubeResearch`/`userIntent`/
  `compressionResult`** — all gone. Content is read live from the pinned artifact version at
  publish; the legacy `type` field (H3, a workflow-name string) has no successor here (the
  artifact carries `type`).
- **`_id` is the BullMQ `jobId` and `data.postId`** for the schedule queue (§5) — unchanged
  contract, now keyed on `Post._id`. Safe under the clean write-over (no in-flight legacy
  jobs at cutover; Redis flushed per #100 §0).

## 3. Creating a post from an artifact

One creation endpoint that captures the whole decision (artifact + version + account + when):

```
POST /posts   { artifactId, version?, connectedAccount, scheduledAt? }
```

Flow:

1. **Resolve & authorize** — load the artifact owner-scoped (`Forbidden` if not the
   caller's, same pattern as `PostService`); resolve `version` (defaults to the artifact's
   `currentVersion`); resolve the connected account via the existing
   `getOwnedUsableLinkedinConnectedAccount(userId, accountId, action)`.
2. **Validate publishability**
   - the pinned artifact **version must be `READY`** (#102 §2) — cannot post a `GENERATING`
     or `FAILED` version;
   - the **composition is valid for LinkedIn** — for v1 (single artifact) trivially so; the
     check is the seam where a future text+image pair is validated against #101 §4's
     mutual-exclusivity;
   - company-page authoring keeps the existing `assertCompanyPagesAccess` gate for org
     accounts.
3. **Branch on `scheduledAt`**
   - **absent → publish now:** run the publish routine (§5) inline; persist `Post` as
     `PUBLISHED` (+ `channelPostId`, `publishedAt`) or `FAILED` (+ `failureReason`).
   - **present → schedule:** first-time schedule asserts the `scheduled_posts` counter (§7);
     persist `Post` as `SCHEDULED` (+ `scheduledAt`); enqueue the schedule job (§5);
     increment the counter.
4. Return the `Post`.

**Rejected — create a Post at artifact-generation time.** Breaks charter #1 (artifacts are
account-agnostic library items); most artifacts are refined/discarded and never posted, so a
Post per artifact is mostly dead records.

## 4. Version pinning — post the version the user approved

An artifact is **mutable**: refine appends a new `currentVersion`, and a manual `PATCH` edits
the head in place (#102 §5). A Post therefore stores **`{ artifact, version }`**, pinned at
creation, and publishes **that** version's content — not "whatever is latest at fire time."

- A post **scheduled** for next Tuesday publishes the version approved today, even if the
  artifact is refined thrice before then.
- If the pinned version is later **soft-deleted or otherwise unresolvable** at fire time, the
  worker fails the Post gracefully (`FAILED`, reason `"source artifact unavailable"`) rather
  than publishing stale or empty content.

**Rejected — always publish the artifact's current head at fire time.** Surprising: a refine
meant to save as a *new* draft would silently rewrite an already-scheduled post. Pinning makes
"what will go out" deterministic at schedule time.

## 5. Publish flow — what's reused vs rebuilt

Publish is **one routine** (`publishPost(postId)`), invoked **inline** for immediate publish
and by the **`post-schedule` worker** at fire time — same code both paths (DRY; the worker
handler in `workflow.worker.ts` already reads `job.data.postId` and calls a publish method).

**Reused verbatim from today's `publishOnLinkedIn`:**

- The `POST {LINKEDIN_API_BASE}/posts` call with the `LinkedIn-Version: 202601` /
  `X-Restli-Protocol-Version: 2.0.0` / `Bearer` header trio (#101 confirms 202601 is valid
  for posts, polls, and documents).
- `resolveLinkedinAuthorUrn(connectedAccount)`, the `visibility`/`distribution`/
  `lifecycleState`/`isReshareDisabledByAuthor` envelope, `commentary` via
  `formatLinkedinContent`, `x-restli-id` capture into `channelPostId`.
- Connected-account decryption (`encryptionService.decrypt`) and the
  `"Organization permissions must be used"` → reconnect error mapping.
- **`ScheduleQueue` / the `post-schedule` queue unchanged** — `addScheduleJob(postId,
  userId, delay)`, `jobId: postId`, `removeOnFail: false`; worker → `publishPost`.

**Rebuilt — content composition reads the artifact, not `post.content`/`post.media[]`:**

The old code folded `post.content` + READY `post.media[]` into `IContent`. The new code
resolves each pinned artifact version's **`ArtifactContent`** (#102 §4) and composes per type,
using the **#101** publish facts:

| Artifact `type` | `commentary` | `content` object | LinkedIn asset upload at publish |
|---|---|---|---|
| **POST** | the text | *(none)* | none |
| **POLL** | optional | `content.poll = { question, options[], settings:{ duration, voteSelectionType:'SINGLE_VOTE', isVoterVisibleToAuthor:true } }` | **none** — poll is inline JSON (#101 §1, §5) |
| **DOCUMENT** | optional | `content.media = { id: <documentUrn>, title }` | **yes** — upload the version's R2 `pdfUrl` → LinkedIn (#101 §2–3) |

- **`IContent` gains a `poll` arm** (today it has only `media`/`multiImage`); document rides
  in the existing `media.id` with a `urn:li:document:*` id (no new `IContent` field — #101 §5).
- **Duration mapping:** #102 stores `durationDays: 1|3|7|14` → LinkedIn `settings.duration`
  `ONE_DAY|THREE_DAYS|SEVEN_DAYS|FOURTEEN_DAYS`; `voteSelectionType` fixed `SINGLE_VOTE`,
  `isVoterVisibleToAuthor` fixed `true` (`false` returns 400 — #101 §1).
- **Document asset upload happens at publish time**, sourcing the already-rendered PDF from
  the artifact version's R2 `pdfUrl` (rendered during generation, #102 §4 / #108). A new
  `uploadDocument` on `LinkedinMediaService` — modeled on `uploadImage`, **not** `uploadVideo`:
  `POST /rest/documents?action=initializeUpload` → single PUT of the PDF bytes → the returned
  `value.document` URN; **no chunking / ETags / finalize** (#101 §3). Defensively poll
  `GET /rest/documents/{urn}` to `AVAILABLE` before attaching (mirrors `waitForVideoAvailable`;
  #101 §3 flags the wait as unconfirmed — poll to be safe). Enforce ≤100 MB / ≤300 pages
  before upload (#101 §2).

**Retired for v1 (preserved as the future-image seed, not deleted):** the **post-level
embedded-media user-upload path** — `addLinkedinMedia`, the presigned `initiate/complete`
direct-to-R2 flow, and the `media-upload` queue that patched `PostDraft.media.$`. Artifact
content is produced by *generation* (documents pre-rendered to R2), so a post never uploads
user media in v1. `LinkedinMediaService`'s **LinkedIn-upload half** (`uploadImage`/new
`uploadDocument`, `waitFor*Available`, R2 `getFile`) is reused by `publishPost`; its
**user-upload half** stays dormant for the future **image artifact** type (charter: image is
later work), when a Post would reference a text artifact + an image artifact.

**Immediate-publish latency note:** a DOCUMENT immediate-publish does init→PUT→poll inline, so
the HTTP call blocks on the LinkedIn upload. Acceptable for a one-shot PUT; if it proves slow,
route immediate publish through the schedule queue with `delay: 0` (same `publishPost`) — the
seam is already there.

## 6. Cancel / reschedule / retry

- **`DELETE /posts/:id`** — cancels a `SCHEDULED` post: `scheduleQueue.queue.getJob(postId)`
  → `remove()`, then delete the record (or mark terminal). Same job-id assumption as today,
  now on `Post._id`. Does **not** touch the source artifact.
- **`POST /posts/:id/schedule` `{ scheduledAt }`** — reschedule a `SCHEDULED`/`FAILED` post
  (remove old job, add new); reuses today's remove-then-re-add logic. First-ever schedule
  counts against `scheduled_posts`; a reschedule of an already-counted post does **not**
  re-charge (today's `isFirstTimeSchedule` rule).
- **`POST /posts/:id/publish`** — publish a `SCHEDULED`/`FAILED` post immediately (removes any
  pending job, runs `publishPost`). Enables a one-click retry of a `FAILED` post.

## 7. Migration residue from the compat audit (H2/H3/H7/H8)

- **H2 — `@InjectModel('PostDraft')` string token** in `auth.service.ts:76` → `Post`
  (register `{ name: Post.name, schema: PostSchema }` in `database.module`; update the
  disconnect logic's model + queue calls). Fails loud at boot if missed.
- **H3 — legacy `type` field** (workflow-name string): dropped, no successor on `Post` (the
  artifact owns `type`). `getPosts`/metrics no longer aggregate on it.
- **H7 — usage triggers:** `scheduled_posts` **stays a capacity counter** (#105 §7) —
  `schedulePost` keeps `assertScheduledPostQuota` + `incrementScheduledPostUsage` on
  first-time schedule; **monotonic (no decrement)** preserved (delete/cancel/disconnect do not
  refund — an explicit carry-over of today's behavior). `ai_drafts` is **retired** (#105 §7):
  generation is credit-metered on the artifact create/refine path (#102/#105), so post
  creation carries **no `ai_drafts` gate**. Immediate publish is **not** counted against
  `scheduled_posts` (matches today — only scheduling counts).
- **H8 — account-disconnect safety** (`auth.service` disconnect): repoint the query from
  `postdrafts status:'SCHEDULED'` to `posts status:'SCHEDULED'` for the disconnected
  `connectedAccount`; for each, `getJob(post._id).remove()` and set the post
  `FAILED`, reason `"connected account disconnected"` (there is no `DRAFT` to reset to —
  §1; the **source artifact is untouched** in the library, so the user re-posts it after
  reconnecting). Add a regression test for disconnect → schedule-job cancel (audit called this
  out explicitly).

## 8. HTTP surface (`api/v1/posts`, behind the auth guard, owner-scoped)

| Method | Route | Body / Query | Result |
|---|---|---|---|
| POST | `/posts` | `{artifactId, version?, connectedAccount, scheduledAt?}` | `201 Post` (PUBLISHED now, or SCHEDULED) |
| POST | `/posts/:id/publish` | — | publish now / retry a FAILED post |
| POST | `/posts/:id/schedule` | `{scheduledAt}` | reschedule |
| DELETE | `/posts/:id` | — | cancel a SCHEDULED post + remove job |
| GET | `/posts` | `?status&month&connectedAccount&page` | list + `filters {availableMonths, connectedAccountIds}` |
| GET | `/posts/:id` | — | one post (with resolved artifact refs) |
| GET | `/posts/metrics/:connectedAccountId` | — | `{ total, monthly[] }` |

- **List/detail** reuse today's `getPosts` shape and the `%Y-%m` `availableMonths`
  aggregation, re-pointed at `posts`; `filters.connectedAccountIds` stays (posts *are*
  account-bound, unlike artifacts). Detail resolves the `{artifact, version}` refs so the
  client can render what was posted; content itself lives on the artifact (#102).
- **`GET /posts/linkedin/image/:urn`** (LinkedIn image proxy) — reused unchanged.
- Per #100 §0 there is **no versioned endpoint / read-adapter**; the SPA migrates to this
  shape (clean write-over).

## 9. Boundaries (owned by other tickets)

| Concern | Owner |
|---|---|
| `Artifact` schema, versions, `ArtifactContent` (poll/document shapes), READY gate, R2 `pdfUrl` | #102 |
| LinkedIn poll/document API facts (endpoints, constraints, upload flow) | #101 (research) |
| `Slide` internals / Browserless PDF render that fills `pdfUrl` | #108 |
| Generation engine + run record that produces READY versions | #103 |
| Credit gating on generation/refine; `scheduled_posts` staying a counter | #105 |
| Image artifact type (would make `artifacts[]` length > 1) + reviving the user-upload media path | future |

## 10. Migration note (clean write-over, #100)

- **New `posts` collection** (`Post`/`PostStatus` above); register in `database.module`.
  **Delete** `post-draft.schema.ts` (+ `PostDraftStatus`), and the `PostDraft`-coupled methods
  in `post.service.ts` (`createDraft`, `updateContent`, `addLinkedinMedia`,
  `initiate/completeMediaUpload`, embedded-`media` logic) and their DTOs; keep and re-point
  `publishOnLinkedIn`→`publishPost`, `schedulePost`, `deletePost`, `getPosts`, `getPost`,
  `getPostMetrics`.
- **`agent.service.ts` `updateDraft`** and `createLinkedinDraft.step.ts` are removed with the
  legacy engine (#104 §12) — generation now writes `Artifact` versions (#102/#103), not
  `PostDraft`.
- **`IContent` gains `poll`**; `LinkedinMediaService` gains `uploadDocument` +
  `waitForDocumentAvailable`; `MediaType`/publish branch gains `DOCUMENT`.
- **`auth.service`** disconnect logic re-pointed (H2/H8).
- **No data migration** (drop `postdrafts`, flush Redis + R2 per #100 §0).
- **Tests** (CLAUDE.md): `post.service.spec.ts` updated for the artifact-ref publish
  composition (POST/POLL/DOCUMENT → `IContent`), version pinning, immediate-vs-scheduled
  branch, disconnect→cancel; `linkedin-media.service.spec.ts` for `uploadDocument` (single
  PUT, no finalize). Manual construction + `makeService()` + `jest.mock(..., { virtual: true })`,
  run with `bun jest`.
