# Post Schema & Publish Flow — Design

> Status: implemented design, amended 2026-07-18 for mutable Post composition and uploaded media.
> Author: generated for Christopher Pam. Decisions settled 2026-07-09.
> Blocked by #100 (compat audit — resolved as a clean write-over) and #101 (LinkedIn
> poll/document API research); both docs land in `docs/`.
> Supersedes `src/database/schemas/post-draft.schema.ts` and the `PostDraft`-coupled
> half of `src/post/post.service.ts`.

Feeds the final spec assembly (#110). Consumes the `Artifact` library (#102), the
LinkedIn publish facts (#101), and the credit counters (#105). Interlocking tickets are
referenced inline.

## Framing (charter-derived givens)

- **Charter #1 / #102:** generated content lives as an account-agnostic **`Artifact`**. A
  `Post` references the selected version and owns the account-specific publishing composition,
  including user-uploaded media.
- **Charter #2:** uploaded images/videos are Post media, not image artifacts. LinkedIn carries **commentary
  + at most one mutually-exclusive content object** (poll *xor* document *xor* image/media).
  So the multi-ref array is real in the schema but **publish-composition enforces LinkedIn's
  one-content-object rule** — for v1 (artifact types POST/POLL/DOCUMENT, image is future) a
  post binds **exactly one** artifact; uploaded media is valid only beside a POST artifact.
- **Clean write-over (#100 §0):** relaunch, no users. Drop `postdrafts`, build `posts`
  clean — no backfill, no `_id` preservation, no coexistence window, no versioned
  endpoints. The compat audit's data-migration hazards (H1/H4/H6/H9/H10) are moot; its
  *engineering residue* (H2/H3/H7/H8) is addressed in §7.

---

## 1. The core decision: a Post is a mutable publishing composition

Artifacts remain the reusable source of generated content, but they are not the complete
account-specific preview. A Post is created as `DRAFT`, pins an artifact version and account,
owns uploaded media, and lets the user confirm the complete LinkedIn composition before an
explicit publish or schedule action.

This collapses the status enum to three states and removes a whole redundant lifecycle:

```
DRAFT → SCHEDULED → PUBLISHED
DRAFT → PUBLISHED
SCHEDULED → FAILED        (publish attempt errored, or account disconnected — §7)
FAILED → DRAFT            (composition edit)
FAILED → SCHEDULED | PUBLISHED
SCHEDULED → DRAFT         (explicit unschedule)
```

The earlier rejection of `DRAFT` is superseded: it omitted the account-specific media and
preview/confirmation stage. Post still does not duplicate artifact content.

## 2. `Post` schema

```ts
enum PostStatus { DRAFT = 'DRAFT', SCHEDULED = 'SCHEDULED', PUBLISHED = 'PUBLISHED', FAILED = 'FAILED' }

@Schema({ timestamps: true })
class Post {
  _id
  user:             ObjectId<User>              // owner, required
  connectedAccount: ObjectId<ConnectedAccount>  // bound HERE (deferred from artifact create, #102 §6)
  title?:            string                     // independent 1–100 character composer label
  artifacts: [{                                  // ordered refs — v1: length 1 (§0 framing)
    artifact: ObjectId<Artifact>,
    version:  number,                            // PINNED at post creation (§4)
  }]
  media: [{ id, linkedinUrn?, type, title?, altText?, status,
            mimeType?, sizeBytes?, pendingExpiresAt? }]
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
- **No embedded generated content/type/style metadata**. Generated content is read from the pinned artifact version;
  `media[]` contains only Post-owned user uploads and their transfer lifecycle.
  publish; the legacy `type` field (H3, a workflow-name string) has no successor here (the
  artifact carries `type`).
- **`_id` is the BullMQ `jobId` and `data.postId`** for the schedule queue (§5) — unchanged
  contract, now keyed on `Post._id`. Safe under the clean write-over (no in-flight legacy
  jobs at cutover; Redis flushed per #100 §0).

## 3. Creating a post from an artifact

Creation captures the artifact/version and immutable account, but performs no external action:

```
POST /posts   { artifactId, version?, connectedAccount }
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
3. Persist and return `DRAFT`. `scheduledAt` is rejected; `/publish` and `/schedule` capture
   explicit confirmation.

Posts are still not created at artifact-generation time; the user creates one when composing
an account-specific publication.

## 4. Version pinning — post the version the user approved

An artifact is **mutable**: refine appends a new `currentVersion`, and a manual `PATCH` edits
an unpinned head in place (#102 §5). `PATCH` is blocked once that version is referenced by a
SCHEDULED or PUBLISHED Post. A Post therefore stores **`{ artifact, version }`**, pinned at
creation, and publishes **that** version's content — not "whatever is latest at fire time."
Scheduling and publishing increment the artifact family's `pinRevision`; editor updates
compare that revision atomically so a concurrent action cannot slip between the pin check
and the content write.

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

**Rebuilt — generated content reads the artifact; uploaded media reads `post.media[]`:**

The code resolves the pinned artifact version's **`ArtifactContent`** (#102 §4) and, for POST,
folds READY uploaded media into the LinkedIn content object. It composes per type,
using the **#101** publish facts:

| Artifact `type` | Artifact framing text | `content` object | LinkedIn asset upload at publish |
|---|---|---|---|
| **POST** | the text | *(none)* | none |
| **POLL** | optional | `content.poll = { question, options[], settings:{ duration, voteSelectionType:'SINGLE_VOTE', isVoterVisibleToAuthor:true } }` | **none** — poll is inline JSON (#101 §1, §5) |
| **DOCUMENT** | optional | `content.media = { id: <documentUrn>, title }` | **yes** — upload the version's R2 `pdfUrl` → LinkedIn (#101 §2–3) |

- **Wire-level commentary is always present:** LinkedIn's Posts contract requires
  the top-level `commentary` field for every content type. POLL and DOCUMENT may
  omit framing text in their artifact content, but `publishPost` serializes that
  absence as `commentary: ""`.
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

**Restored:** the direct-to-R2 `initiate/complete` flow and `media-upload` worker. Media keeps
a stable UUID in `id`; the worker writes the resulting LinkedIn asset to `linkedinUrn` and
marks it READY. Uploads are allowed only on editable POST compositions. Publish/schedule block
until every remaining media item is READY; FAILED media must be removed or re-uploaded.

**Immediate-publish latency note:** a DOCUMENT immediate-publish does init→PUT→poll inline, so
the HTTP call blocks on the LinkedIn upload. Acceptable for a one-shot PUT; if it proves slow,
route immediate publish through the schedule queue with `delay: 0` (same `publishPost`) — the
seam is already there.

## 6. Cancel / reschedule / retry

- **`POST /posts/:id/unschedule`** — removes the scheduled job and returns the Post to DRAFT.
  `DELETE /posts/:id` still removes the Post entirely.
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
  `FAILED`, reason `"connected account disconnected"`. The Post becomes editable and returns
  to DRAFT on its next composition edit; the source artifact is untouched. Add a regression
  test for disconnect → schedule-job cancel (audit called this
  out explicitly).

## 8. HTTP surface (`api/v1/posts`, behind the auth guard, owner-scoped)

| Method | Route | Body / Query | Result |
|---|---|---|---|
| POST | `/posts` | `{title?, artifactId, version?, connectedAccount}` | `201 DRAFT`; title defaults from artifact metadata/source prompt |
| PATCH | `/posts/:id` | `{title?, artifactId?, version?}` | partial title/selection edit while editable |
| POST | `/posts/:id/media/uploads` | file declarations | presigned R2 slots |
| POST | `/posts/:id/media/uploads/complete` | `{mediaIds}` | enqueue LinkedIn transfer |
| PATCH/DELETE | `/posts/:postId/media/:mediaId` | metadata / — | edit or remove media |
| GET | `/posts/:postId/media/:mediaId/preview` | — | image/video preview URL |
| POST | `/posts/:id/publish` | — | publish DRAFT/SCHEDULED/FAILED |
| POST | `/posts/:id/schedule` | `{scheduledAt}` | reschedule |
| POST | `/posts/:id/unschedule` | — | SCHEDULED → DRAFT |
| DELETE | `/posts/:id` | — | cancel a SCHEDULED post + remove job |
| GET | `/posts` | `?status&month&connectedAccount&page` | list + filters; artifact refs populated with `_id`, `type`, optional `title`, and `source.prompt` |
| GET | `/posts/:id` | — | one post with the same minimal artifact metadata and exact pinned-version payloads |
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
| Additional artifact families | future |

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
- **Tests** (AGENTS.md): `post.service.spec.ts` updated for the artifact-ref publish
  composition (POST/POLL/DOCUMENT → `IContent`), version pinning, immediate-vs-scheduled
  branch, disconnect→cancel; `linkedin-media.service.spec.ts` for `uploadDocument` (single
  PUT, no finalize). Manual construction + `makeService()` + `jest.mock(..., { virtual: true })`,
  run with `bun jest`.
