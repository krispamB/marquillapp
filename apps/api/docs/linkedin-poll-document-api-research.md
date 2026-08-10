# LinkedIn Poll & Document (Carousel) Post API Research

> Status: research report for wayfinder map #99, ticket #101.
> Author: generated for Christopher Pam.
> Scope: primary-source API research only. No code changes. Every factual claim
> cites the first-party LinkedIn doc page (learn.microsoft.com/linkedin) that owns it.
>
> **2026-07-18 implementation note:** references below to `PostDraft.media[]` describe the
> machinery at research time. The current `Post.media[]` keeps a stable UUID in `id` and
> stores the uploaded LinkedIn image/video asset in `linkedinUrn`. Poll/document mutual
> exclusivity remains unchanged; uploaded Post media is allowed only with POST artifacts.

All findings below are drawn from the versioned **REST** API docs (the `/rest/*`
surface the app already targets in `src/post/linkedin-media.service.ts`), not the
legacy `/v2/ugcPosts` API. The app currently sends `LinkedIn-Version: 202601`,
which maps to the doc moniker `li-lms-2026-01`. Every API discussed here lists
`li-lms-2026-01` in its supported moniker range, so **202601 is a valid version
for polls, documents, and the Posts API**
([Posts API moniker range](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-04),
[Poll API moniker range](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/poll-post-api?view=li-lms-2026-05),
[Documents API moniker range](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/documents-api?view=li-lms-2025-11)).

---

## 1. Poll posts

**Endpoint & method.** A poll is created through the *same* Posts endpoint the app
already uses — there is no separate poll endpoint. You `POST https://api.linkedin.com/rest/posts`
with a `content.poll` object. The dedicated Poll API doc says polls are created and
managed "using the Posts API" and "Updating poll content is not allowed"
([Poll API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/poll-post-api?view=li-lms-2026-05)).

**No binary upload.** Polls have no media asset. There is no `initializeUpload`
step — the whole poll is inline JSON in the post body
([Poll API create request](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/poll-post-api?view=li-lms-2026-05)).

**Request shape** (verbatim from the doc):

```json
{
 "author": "urn:li:organization:2414183",
 "commentary": "test poll",
 "visibility": "PUBLIC",
 "distribution": {
   "feedDistribution": "MAIN_FEED",
   "targetEntities": [],
   "thirdPartyDistributionChannels": []
 },
 "lifecycleState": "PUBLISHED",
 "isReshareDisabledByAuthor": false,
 "content": {
     "poll": {
       "question" :"What is your favorite color?",
       "options" : [ { "text" : "Red" }, { "text" : "Blue" }, {"text": "Yellow"}, {"text": "green"} ],
       "settings" : { "duration" : "THREE_DAYS" }
     }
 }
}
```

Source: [Poll API — Create Poll content](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/poll-post-api?view=li-lms-2026-05).
A successful create returns `201 Created` with the new post ID in the `x-restli-id`
response header (same convention as image/video posts).

**Constraints** (all from the Poll / PollSettings / PollOption schema tables,
[Poll API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/poll-post-api?view=li-lms-2026-05)):

| Constraint | Value |
| --- | --- |
| Number of options | **min 2, max 4** ("There must be at least two. Maximum 4 options.") |
| Option `text` length | **max 30 characters** |
| `question` length | **max 140 characters** (create-only required) |
| `settings.duration` | one of `ONE_DAY`, `THREE_DAYS`, `SEVEN_DAYS`, `FOURTEEN_DAYS` (**required**) |
| `settings.voteSelectionType` | `SINGLE_VOTE` (default). `MULTIPLE_VOTE` is documented as "To be supported later in future" — treat as unavailable today |
| `settings.isVoterVisibleToAuthor` | defaults `true`; **`false` is not supported and returns 400** |
| Post `visibility` | `PUBLIC` in the sample; the field itself accepts `PUBLIC` / `CONNECTIONS` per the Posts schema |

**Access / restriction.** The doc states plainly: **"API partners can only create
non-sponsored poll posts."** Polls are also organic-only in the Posts content-type
matrix — `Poll` is `Organic: Yes / Sponsored: No`
([Posts API content-type table](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-04)).
Required scopes are `w_member_social` (member author) or `w_organization_social`
(org author, requires ADMINISTRATOR / DIRECT_SPONSORED_CONTENT_POSTER / CONTENT_ADMIN
page role) — the same scopes the app already uses for image/video posts
([Poll API — Permissions](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/poll-post-api?view=li-lms-2026-05)).
There is also a content-policy caveat: poll authors "may not ask for political
opinions, health status, or other sensitive data"
([Poll API note](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/poll-post-api?view=li-lms-2026-05)).

---

## 2. Document posts (PDF / carousel)

**Terminology — important.** On LinkedIn there are two different things both loosely
called "carousel":

1. **Document post** — a multi-page **PDF/PPT/DOC** rendered as a swipeable,
   page-by-page card unit in the feed. This is the organic "carousel/PDF" format
   end users see. It is created as a normal post with a **document URN** in
   `content.media` ([Documents API — Create Document content](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/documents-api?view=li-lms-2025-11)).
2. **`content.carousel`** — a *distinct*, **sponsored-only** ad format made of image
   `cards` with landing pages. The Posts content-type matrix marks `Carousels` as
   `Organic: No / Sponsored: Yes`, and the Posts doc says "Only create sponsored
   carousel post. Organic carousel is currently not supported."
   ([Posts API — Carousel section](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-04)).

**So for our use case (organic "carousel"-style PDF posts), the artifact is a
document post — a multi-page PDF — not `content.carousel`.** The `content.carousel`
type is not available to us for organic posting.

**Endpoint & method (asset).** `POST https://api.linkedin.com/rest/documents?action=initializeUpload`
— directly analogous to `/rest/images?action=initializeUpload` and
`/rest/videos?action=initializeUpload`
([Documents API — Initialize Document Upload](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/documents-api?view=li-lms-2025-11)).

Init request body (verbatim) — identical envelope to the image init the app already sends:

```json
{
  "initializeUploadRequest": {
        "owner": "urn:li:organization:1234567"
  }
}
```

Init response (verbatim):

```json
{
   "value": {
       "uploadUrlExpiresAt": 1650567510704,
       "uploadUrl": "https://www.linkedin.com/dms-uploads/D5510AQHXjcP8QBYD9A/ads-uploadedDocument/0?ca=vector_ads&cn=uploads&sync=0&v=beta&ut=36ezHi_Pod5aM1",
       "document": "urn:li:document:C5F10AQGKQg_6y2a4sQ"
   }
}
```

**Constraints** ([Documents API — "Important" note](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/documents-api?view=li-lms-2025-11)):

| Constraint | Value |
| --- | --- |
| Max file size | **100 MB** ("The file size can't exceed 100MB and 300 pages") |
| Max page count | **300 pages** |
| Accepted formats | **PPT, PPTX, DOC, DOCX, PDF** |

**Attaching to a post.** The returned `document` URN goes into `content.media.id`
— the exact same `content.media` shape used for single images and single videos.
Create request (verbatim):

```json
{
    "author": "urn:li:organization:1234567",
    "commentary": "test strings!",
    "visibility": "PUBLIC",
    "distribution": {
        "feedDistribution": "MAIN_FEED",
        "targetEntities": [],
        "thirdPartyDistributionChannels": []
    },
    "content": {
        "media": {
            "title":"Example.pdf",
            "id": "urn:li:document:D5510AQFx87994pYx0Q"
        }
    },
    "lifecycleState": "PUBLISHED",
    "isReshareDisabledByAuthor": false
}
```

Source: [Documents API — Create Document content](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/documents-api?view=li-lms-2025-11).
This is the app's existing `IContent.media` shape (`{ id, title, altText? }`) with a
`urn:li:document:*` id instead of `urn:li:image:*` / `urn:li:video:*`. Documents are
organic-capable: the content-type matrix lists `Documents` as `Organic: Yes /
Sponsored: Yes` ([Posts API content-type table](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-04)).

---

## 3. Upload flows

**Document upload is single-shot, like images — NOT chunked like videos.** Using the
`uploadUrl` from init, you do one PUT of the whole file. The doc's sample uses
`curl --upload-file ~/Desktop/Mydoc.pdf` (a single HTTP PUT) and shows a bare
`HTTP/2 201` response with no body
([Documents API — Upload the Document](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/documents-api?view=li-lms-2025-11)).

Key differences vs the app's video flow (which the app implements in
`uploadVideo`): documents have **no `uploadInstructions` array, no per-chunk ETags,
and no `finalizeUpload` step**. There is nothing analogous to `videos?action=finalizeUpload`.
The doc explicitly notes `SYNCHRONOUS_UPLOAD` is **not** supported for documents
([Documents API — Initialize note](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/documents-api?view=li-lms-2025-11)).

**Headers.** The init/GET calls require the standard trio the app already sends:
`Linkedin-Version: {YYYYMM}`, `X-Restli-Protocol-Version: 2.0.0`, and
`Authorization: Bearer …` ([Documents API — Schema note](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/documents-api?view=li-lms-2025-11)).
The actual binary PUT to `uploadUrl` in the doc's curl example carries only
`Authorization` (mirrors how the app PUTs image bytes with `Content-Type:
application/octet-stream`).

**Status polling.** A document asset has a `status` field:
`WAITING_UPLOAD` → `PROCESSING` → `AVAILABLE`, or `PROCESSING_FAILED` on error
([Documents API — status schema](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/documents-api?view=li-lms-2025-11)).
You can `GET https://api.linkedin.com/rest/documents/{documentUrn}` to read it — the
same AVAILABLE-polling pattern the app uses for video via `waitForVideoAvailable`.
The doc does not state that polling to `AVAILABLE` is *required* before attaching the
document to a post (it demonstrates upload → immediately create post), so whether a
wait is strictly necessary is not confirmed from primary sources — see Open questions.

---

## 4. Combining artifact types

**Content types are mutually exclusive — one content type per post.** `content` is a
union: every documented example sets exactly one of `content.media` (single
image / video / **document**), `content.multiImage`, `content.poll`,
`content.article`, or `content.carousel`. The Posts API presents them as distinct
"Content Types" rows in its support matrix and never shows two set together
([Posts API content-type table](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-04)).

Consequences for map #99:

- **Poll + image / poll + document: not possible.** A poll post carries only
  `content.poll`; there is no field to attach media to a poll
  ([Poll API schema](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/poll-post-api?view=li-lms-2026-05)).
- **Document + image: not possible.** A document post is `content.media` with a
  single document URN; you cannot also attach an image in the same post.
- **Every post carries the top-level `commentary` field.** The Posts schema marks
  `commentary` required, independently of `content`, and the poll/document examples
  both include it. The app may model framing text as optional for a poll or document,
  but the outbound Posts request must still serialize `commentary` (as an empty
  string when the artifact has no framing text)
  ([Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-04),
  [Poll API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/poll-post-api?view=li-lms-2026-05)).
- **`multiImage`** (many images) and single `media` are themselves mutually
  exclusive — exactly as the app already models in `publishOnLinkedIn`
  (single → `content.media`, many → `content.multiImage`).

Caveat: the docs never print a single explicit sentence "content sub-fields are
mutually exclusive." This conclusion is inferred from the union-style schema, the
one-type-per-example convention, and the separate-rows content matrix. It is
consistent across every LinkedIn example but is an inference, not a verbatim rule —
flagged in Open questions.

---

## 5. How polls / documents compose with the existing R2 media machinery

Recap of the current pipeline (`src/post/post.service.ts`,
`src/post/linkedin-media.service.ts`, `src/workflow/media-upload.queue.ts`): media
bytes are stored in R2 at `media-uploads/${postId}/${mediaId}`, a BullMQ
`media-upload` job later fetches from R2 and calls `uploadImage`/`uploadVideo`, then
patches the `PostDraft.media[]` entry's `id` to the returned LinkedIn URN with
`status: READY`. At publish, `publishOnLinkedIn` folds READY media into `content`.

### Documents — YES, reuse the R2 → worker → initializeUpload pattern almost verbatim

A PDF is binary like an image/video, so it fits the existing machinery with minimal
change:

- **R2 storage:** unchanged — store the PDF at the same `media-uploads/${postId}/${mediaId}`
  key.
- **New upload method** (call it `uploadDocument`): modeled on `uploadImage`, **not**
  `uploadVideo`. It does init → single PUT → return `value.document`. **No chunking,
  no ETags, no finalizeUpload** (see §3). This is strictly simpler than the video path.
- **Media type:** the worker's branch (`item.mediaType === 'VIDEO' ? uploadVideo :
  uploadImage`) needs a third `'DOCUMENT'` branch. `MediaUploadJobItem.mediaType` and
  the `PostDraft.media[].type` enum must gain `'DOCUMENT'`.
- **Content assembly:** in `publishOnLinkedIn`, a single document becomes
  `content.media = { id: <documentUrn>, title }` — the *same* branch shape as a single
  image/video, just sourced from a document-typed media entry. `IContent` needs no new
  field; the document URN rides in the existing `media.id`.
- **Optional AVAILABLE poll:** if we decide to wait for processing, add a
  `waitForDocumentAvailable` mirroring `waitForVideoAvailable` but hitting
  `/rest/documents/{urn}` (see §3 caveat on whether this is required).
- **Constraints to enforce before upload:** reject > 100 MB / > 300 pages / non
  PPT-PPTX-DOC-DOCX-PDF (§2).

Net: documents are the *easiest* new artifact — they slot into the image-style
single-PUT path and the existing `content.media` publish branch.

### Polls — NO upload at all; they bypass the R2/media machinery entirely

Polls have **no binary asset**, so they never touch R2, the `media-upload` queue, or
`LinkedinMediaService`. A poll is pure inline JSON assembled at publish time. What is
needed instead:

- Persist poll definition (question, options[], duration, voteSelectionType) on the
  post document — a new field, *not* a `media[]` entry.
- Extend `IContent` with a `poll?: { question; options: {text}[]; settings: {duration;
  voteSelectionType?} }` field and build it in `publishOnLinkedIn`.
- Enforce poll constraints (2–4 options, ≤30 chars/option, ≤140 char question, valid
  duration enum, `isVoterVisibleToAuthor` must be true) at DTO-validation time.
- Because content types are mutually exclusive (§4), a poll post must *not* also have
  READY media — the publish logic must pick poll XOR media, not merge them.

---

## 6. Open questions / access caveats

- **Community Management API product access.** All three APIs live under LinkedIn's
  Marketing / Community Management surface and require `w_member_social` /
  `w_organization_social`. The app **already** posts images and videos through
  `/rest/posts` with these scopes, so this access appears already granted — but it is
  worth confirming the connected LinkedIn app's product grant explicitly includes the
  **Community Management API** (formerly Marketing Developer Platform) for polls and
  documents, since LinkedIn gates these features at the app-product level, not per
  endpoint. Not verifiable from the public docs alone.
- **Polls are organic + non-sponsored only, and API-partner-restricted to
  non-sponsored.** Confirmed verbatim ("API partners can only create non-sponsored
  poll posts"). No workaround for sponsored polls.
- **Organic `content.carousel` is unavailable.** "Organic carousel is currently not
  supported" — the organic swipeable format must be a **document (PDF) post**, not
  `content.carousel`. Confirmed.
- **Is waiting for document `AVAILABLE` required before attaching to a post?** The
  Documents doc shows upload immediately followed by post creation and does not state a
  mandatory wait. The video flow *does* require AVAILABLE. This is **not confirmed**
  for documents from primary sources — recommend defensively polling `/rest/documents/{urn}`
  to `AVAILABLE` (as we do for video) and verifying behavior in a sandbox.
- **`multiImage` / `poll` are member-and-org organic only; `MultiImage` is `Sponsored: No`.**
  Confirmed from the content-type matrix. No caveat for our organic use.
- **Mutual-exclusivity of `content` sub-fields is inferred, not a verbatim rule.** See
  §4 — consistent across all examples and the schema, but LinkedIn never prints an
  explicit "you cannot combine these" sentence. Treat as strongly supported but
  worth a one-shot sandbox confirmation.
- **`MULTIPLE_VOTE` polls** are documented as future ("To be supported later in
  future"). Do not build UI depending on multi-select today.
