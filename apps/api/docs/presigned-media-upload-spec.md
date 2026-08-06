# Spec: Direct-to-R2 media upload via presigned URLs

**Status:** restored on the Artifact-backed Post model · **Updated:** 2026-07-18

## Goal

The client uploads bytes **directly to R2** with a presigned PUT URL. The server
only issues slots, verifies the result, and enqueues the `media-upload` worker
job. The former multipart `PUT /posts/:id/media` route is not supported.

The server → LinkedIn hop is handled by the restored worker: it downloads from
R2, pushes to LinkedIn, updates the Post media entry, and deletes the staging
object.

## Flow overview

```
1. POST /posts/:id/media/uploads            client declares files
      → server validates, creates PENDING media entries,
        returns presigned PUT URLs
2. PUT <presigned R2 URL>                    client → R2, one per file (CORS)
3. POST /posts/:id/media/uploads/complete    client confirms
      → server HeadObject-verifies each file, flips PENDING → UPLOADING,
        enqueues media-upload job, returns 202
4. worker: R2 → LinkedIn → write `linkedinUrn`, READY/FAILED, delete R2 object
5. client polls GET /posts/:id until no UPLOADING entries
```

## Media entry lifecycle

The Post-owned media lifecycle is:

```
PENDING ──(confirm ok)──► UPLOADING ──► READY | FAILED
   │
   └─(expiry / purge)──► entry removed, R2 object reaped by lifecycle rule
```

| Status | Meaning |
|---|---|
| `PENDING` | Slot issued; waiting for the client's direct PUT + confirm |
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

- post exists, is owned, is `DRAFT` or `FAILED`, and selects a POST artifact
- at most 20 images across the whole Post or one video; no cross-batch mixing
- images: `image/jpeg` | `image/png`; video: `video/mp4`
- `sizeBytes` > 0 and ≤ 200 MB per file (400)
- no existing entry in `UPLOADING` or unexpired `PENDING` (409, same
  "already in progress" semantics as today)
- connected account owned + usable (409 reconnect message)

Side effects: purge any **expired** `PENDING` entries on this post, then append
one media entry per file:

```
{ id: <stable uuid>, linkedinUrn: undefined, type, title: fileName, altText (images), status: 'PENDING',
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

- post exists / owned / editable / POST artifact (as above)
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
2. enqueue `MediaUploadQueue.addMediaUploadJob` with
   `{ postId, connectedAccountId, ownerUrn, items }` — job shape, worker,
   retries, FAILED handling, and R2 cleanup
3. respond `202` with `"Media upload started"` and the confirmed entries; the
   polling logic from `docs/async-media-upload-handoff.md` applies from here

Partial confirms are allowed. Any remaining unexpired `PENDING` entry must be
confirmed, removed, or allowed to expire before another upload can be
initiated. A failed confirmed entry can be removed before initiating its
replacement.

### Old endpoint

`PUT /posts/:id/media` remains removed. Direct-to-R2 upload is the only supported path.

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
- `FAILED` → blocks publish/schedule until the item is removed or uploaded again

## Code changes

| File | Change |
|---|---|
| `src/s3/s3.client.ts` | `getSignedUploadUrl(key, mimeType, sizeBytes, expiresIn)` — presign `PutObjectCommand` with signed `ContentType`/`ContentLength`; `headFile(key): Promise<{ sizeBytes; mimeType }>` via `HeadObjectCommand` |
| `src/database/schemas/post.schema.ts` | Post-owned media with stable `id`, separate `linkedinUrn`, type/status, and upload bookkeeping |
| `src/post/dto/` | `InitiateMediaUploadDto` (`files[]`, class-validator: `@IsMimeType`-style allowlist, `@Max(200 MB)`, `@ArrayMaxSize(20)`), `CompleteMediaUploadDto` (`mediaIds[]`) |
| `src/post/post.controller.ts` | two JSON upload routes with no multipart buffering |
| `src/post/post.service.ts` | initiate/complete, metadata edit/removal, preview, composition validation, and publish/schedule guards |
| `src/post/*.spec.ts`, `src/s3/s3.client.spec.ts` | specs for all of the above per AGENTS.md conventions |

The queue contract is reused. `LinkedinMediaService` and the worker update `linkedinUrn`
without replacing the stable media id.

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
- On a failed/interrupted PUT: remove the entry or let its slot expire, then
  initiate a replacement.

## Risks / notes

- **Trust boundary moves**: type/size are enforced by the signed headers +
  Head check, but the server never sees the bytes, so it can no longer sniff
  actual file content. Mitigation if ever needed: magic-byte check in the
  worker after `getFile` (it has the buffer anyway) → mark `FAILED`.
- **Two more round-trips** per upload; negligible next to the transfer itself.
- **Orphaned `PENDING` entries** are visible in `GET /posts/:id` until purged;
  the client should hide expired `PENDING` entries (or we filter them out of
  the GET response server-side — decide during implementation).
- Rollout order: configure infra (CORS + lifecycle), deploy the server routes,
  then switch the client to initiate → PUT → complete.
