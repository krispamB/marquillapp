# Spec: Direct-to-R2 media upload via presigned URLs

**Status:** implemented on `fix/linkedin-image-upload` · **Date:** 2026-07-06

## Goal

Remove the client → server file hop on media uploads. Today `PUT /posts/:id/media`
receives the full multipart body (up to 200 MB/file), buffers it, and re-uploads
it to R2. After this change the client uploads bytes **directly to R2** with a
presigned PUT URL; the server only issues slots, verifies the result, and
enqueues the existing `media-upload` worker job.

The server → LinkedIn hop (worker downloads from R2, pushes to LinkedIn) is
**out of scope and unchanged** — LinkedIn's API requires us to push bytes.

## Flow overview

```
1. POST /posts/:id/media/uploads            client declares files
      → server validates, creates PENDING media entries,
        returns presigned PUT URLs
2. PUT <presigned R2 URL>                    client → R2, one per file (CORS)
3. POST /posts/:id/media/uploads/complete    client confirms
      → server HeadObject-verifies each file, flips PENDING → UPLOADING,
        enqueues media-upload job, returns 202
4. (unchanged) worker: R2 → LinkedIn → READY/FAILED, delete R2 object
5. (unchanged) client polls GET /posts/:id until no UPLOADING entries
```

## Media entry lifecycle

New first state, everything else as-is:

```
PENDING ──(confirm ok)──► UPLOADING ──► READY | FAILED
   │
   └─(expiry / purge)──► entry removed, R2 object reaped by lifecycle rule
```

| Status | Meaning |
|---|---|
| `PENDING` *(new)* | Slot issued; waiting for the client's direct PUT + confirm |
| `UPLOADING` | Confirmed; background worker is transferring to LinkedIn |
| `READY` / `FAILED` / *(absent)* | unchanged |

## API

### 1. `POST /posts/:id/media/uploads` — initiate

Request:

```json
{
  "files": [
    { "fileName": "photo.jpg", "mimeType": "image/jpeg", "sizeBytes": 1048576 }
  ]
}
```

Validation (mirrors today's rules, but against *declared* metadata):

- post exists (404), owned by caller (403), not `PUBLISHED` (400)
- 1–20 files; no image/video mixing; ≤ 1 video (400)
- images: `image/jpeg` | `image/png` only (400)
- `sizeBytes` > 0 and ≤ 200 MB per file (400)
- no existing entry in `UPLOADING` or unexpired `PENDING` (409, same
  "already in progress" semantics as today)
- connected account owned + usable (409 reconnect message)

Side effects: purge any **expired** `PENDING` entries on this post, then append
one media entry per file:

```
{ id: <uuid>, type, title: fileName, altText (images), status: 'PENDING',
  mimeType, sizeBytes, pendingExpiresAt: now + TTL }
```

Response `201`:

```json
{
  "statusCode": 201,
  "message": "Upload slots created",
  "data": {
    "expiresAt": "2026-07-06T13:00:00.000Z",
    "uploads": [
      {
        "mediaId": "3f1c9a1e-…",
        "uploadUrl": "https://<bucket>.<account>.r2.cloudflarestorage.com/media-uploads/…?X-Amz-…",
        "requiredHeaders": {
          "Content-Type": "image/jpeg",
          "Content-Length": "1048576"
        }
      }
    ]
  }
}
```

- R2 key stays `media-uploads/{postId}/{mediaId}`.
- **TTL: 30 minutes** (covers a 200 MB video on a slow uplink; short enough
  that abandoned slots don't block the post for long).
- The presigned URL is generated from a `PutObjectCommand` with `ContentType`
  and `ContentLength` set, so those headers are **part of the signature** — R2
  rejects a PUT whose actual type/length differ from what was declared. This is
  the primary server-side enforcement of size/type.

### 2. Client PUT to R2 (no server involvement)

Single `PUT` with the returned headers and the raw file body. 200 MB is well
under the 5 GB single-PUT ceiling, so no multipart upload is needed.

### 3. `POST /posts/:id/media/uploads/complete` — confirm

Request:

```json
{ "mediaIds": ["3f1c9a1e-…"] }
```

Validation:

- post exists / owned / not published (as above)
- every `mediaId` is an entry on this post with `status: 'PENDING'` and
  unexpired `pendingExpiresAt` (else 409 `"Upload slot expired, re-initiate"`
  or 404 for unknown ids)
- connected account still owned + usable (re-checked; tokens can expire
  between initiate and confirm)
- for each id: `headFile(r2Key)` → object exists (else 400
  `"File was not uploaded"`), `ContentLength === sizeBytes`,
  `ContentType === mimeType` (belt-and-braces on top of the signed headers)

Side effects, in order:

1. flip each confirmed entry `PENDING → UPLOADING`
   (positional `updateOne`, same pattern the worker uses)
2. enqueue the **existing** `MediaUploadQueue.addMediaUploadJob` with
   `{ postId, connectedAccountId, ownerUrn, items }` — job shape, worker,
   retries, FAILED handling, R2 cleanup all unchanged
3. respond `202` with the same body shape as today's media endpoint
   (`"Media upload started"` + the entries), so the client's polling logic
   from `docs/async-media-upload-handoff.md` applies verbatim from here on

Partial confirms are allowed (confirm the images that made it, re-initiate the
one that failed) **except**: a batch containing the post's single video must be
confirmed whole, and mixing is impossible because initiate rejects it.

### Old endpoint

`PUT /posts/:id/media` (multipart) is kept as-is during migration and removed
in a later release once the client has switched. Its `UPLOADING`-in-progress
409 also considers unexpired `PENDING` entries, and vice versa, so the two
paths can't interleave on one post.

## Abandoned slots

Two independent reapers, both required:

1. **Lazy purge (Mongo):** any entry with `status: 'PENDING'` and
   `pendingExpiresAt < now` is deleted from `post.media[]` whenever it gets in
   the way — on initiate, on confirm, and in the publish guard. No cron needed.
2. **R2 lifecycle rule (infra, one-time):** expire objects under the
   `media-uploads/` prefix after **2 days**. Catches objects whose PUT
   succeeded but whose confirm never came, plus any leaked staging objects
   from the current flow. A healthy upload is deleted by the worker within
   minutes, so nothing legitimate is old enough to be reaped.

## Publish guard changes

In `publishOnLinkedIn`:

- unexpired `PENDING` or `UPLOADING` → `409` (same message as today)
- expired `PENDING` → lazily purged, does not block
- `FAILED` → excluded from payload (unchanged)

## Code changes

| File | Change |
|---|---|
| `src/s3/s3.client.ts` | `getSignedUploadUrl(key, mimeType, sizeBytes, expiresIn)` — presign `PutObjectCommand` with signed `ContentType`/`ContentLength`; `headFile(key): Promise<{ sizeBytes; mimeType }>` via `HeadObjectCommand` |
| `src/database/schemas/post-draft.schema.ts` | media status enum + `'PENDING'`; optional `mimeType`, `sizeBytes`, `pendingExpiresAt` on the subdoc |
| `src/post/dto/` | `InitiateMediaUploadDto` (`files[]`, class-validator: `@IsMimeType`-style allowlist, `@Max(200 MB)`, `@ArrayMaxSize(20)`), `CompleteMediaUploadDto` (`mediaIds[]`) |
| `src/post/post.controller.ts` | two new JSON routes (no multer); old multipart route untouched |
| `src/post/post.service.ts` | `initiateMediaUpload`, `completeMediaUpload`, shared `purgeExpiredPendingMedia(post)`; extend the in-progress checks; publish guard tweak |
| `src/post/*.spec.ts`, `src/s3/s3.client.spec.ts` | specs for all of the above per CLAUDE.md conventions |

Not touched: `media-upload.queue.ts`, `linkedin-media.service.ts`, the worker,
the `FAILED`/retry semantics, `GET /posts/:id` polling contract.

## Infra prerequisites (before client rollout)

1. **R2 bucket CORS** — required or every browser PUT fails preflight:

```json
[
  {
    "AllowedOrigins": ["https://<app-domain>", "http://localhost:3000"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type", "Content-Length"],
    "MaxAgeSeconds": 3600
  }
]
```

2. **R2 lifecycle rule** — expire `media-uploads/` prefix after 2 days.

## Client-facing changes (handoff delta)

- Replace the single multipart request with: initiate → parallel PUTs to R2
  (native `fetch`/XHR gives real per-file progress, which multipart never did)
  → complete. Everything after the 202 (polling, statuses, publish gating,
  FAILED recovery) is identical to the current handoff doc.
- New states to render: `PENDING` (treat like `UPLOADING` in the UI), slot
  expiry (`409` on complete → re-initiate).
- On a failed/interrupted PUT: just re-initiate; the abandoned slot expires
  on its own.

## Risks / notes

- **Trust boundary moves**: type/size are enforced by the signed headers +
  Head check, but the server never sees the bytes, so it can no longer sniff
  actual file content. Mitigation if ever needed: magic-byte check in the
  worker after `getFile` (it has the buffer anyway) → mark `FAILED`.
- **Two more round-trips** per upload; negligible next to the transfer itself.
- **Orphaned `PENDING` entries** are visible in `GET /posts/:id` until purged;
  the client should hide expired `PENDING` entries (or we filter them out of
  the GET response server-side — decide during implementation).
- Rollout order: infra (CORS + lifecycle) → server endpoints (old route still
  live) → client switch → remove multipart route.
