# Handoff: Async LinkedIn Media Upload (client-side changes)

**Branch:** `fix/linkedin-image-upload` · **Updated:** 2026-07-06

Media upload is now fully asynchronous **and** direct-to-storage. The client
uploads file bytes straight to Cloudflare R2 with presigned URLs — files no
longer pass through the API server — and a background worker performs the
LinkedIn upload. The client must request upload slots, PUT the files itself,
confirm, then track media status and gate the publish action on it.

The old `multipart/form-data` endpoint (`PUT /posts/:id/media`) still works
during the migration (see §9) but is **deprecated** and will be removed once
the client has switched.

All paths below are relative to the API prefix `api/v1`.

---

## 1. The new flow at a glance

```
1. POST /posts/:id/media/uploads            declare files → 201 with presigned URLs
2. PUT <uploadUrl>                          client → R2 directly, one per file
3. POST /posts/:id/media/uploads/complete   confirm → 202, background upload starts
4. GET /posts/:id                           poll media[].status until no
                                            PENDING/UPLOADING entries remain
```

File rules (unchanged from before): up to 20 files, 200 MB per-file limit,
JPEG/PNG images **or** exactly one video, no mixing images and videos in one
batch.

## 2. Step 1 — initiate: `POST /posts/:id/media/uploads`

Declare every file you intend to upload:

```json
{
  "files": [
    { "fileName": "photo.jpg", "mimeType": "image/jpeg", "sizeBytes": 1048576 }
  ]
}
```

`sizeBytes` must be the **exact** byte size of the file (`File.size` in the
browser) and `mimeType` its exact type (`File.type`) — both are baked into the
presigned URL signature, so R2 will reject the PUT if they don't match.

Response `201`:

```json
{
  "statusCode": 201,
  "message": "Upload slots created",
  "data": {
    "expiresAt": "2026-07-06T13:00:00.000Z",
    "uploads": [
      {
        "mediaId": "3f1c9a1e-6c9d-4e0f-9d2a-6f7b8c9d0e1f",
        "uploadUrl": "https://<bucket>.r2.cloudflarestorage.com/media-uploads/…?X-Amz-…",
        "requiredHeaders": {
          "Content-Type": "image/jpeg",
          "Content-Length": "1048576"
        }
      }
    ]
  }
}
```

- `mediaId` is a **temporary UUID**; it also appears as a new entry in
  `post.media[]` with `status: "PENDING"`. After the LinkedIn upload succeeds
  it is replaced server-side by the LinkedIn URN (`urn:li:image:…` /
  `urn:li:video:…`). Do not persist it beyond this upload flow.
- Slots expire at `expiresAt` (**30 minutes**). All PUTs and the complete call
  must happen before then; afterwards, re-initiate.

## 3. Step 2 — PUT the files directly to R2

One request per file, straight from the browser:

```js
await fetch(upload.uploadUrl, {
  method: 'PUT',
  headers: upload.requiredHeaders,
  body: file, // the File/Blob itself
});
```

- Send **exactly** the `requiredHeaders` returned by initiate. A mismatched
  `Content-Type` or `Content-Length` (i.e. a different file than declared) is
  rejected by R2 with a 403.
- PUTs can run in parallel. This is a plain `fetch`/XHR, so you get real
  per-file upload progress (XHR `upload.onprogress`) — something the old
  multipart endpoint never gave you.
- A failed or interrupted PUT can simply be retried against the same URL until
  the slot expires.

## 4. Step 3 — confirm: `POST /posts/:id/media/uploads/complete`

```json
{ "mediaIds": ["3f1c9a1e-6c9d-4e0f-9d2a-6f7b8c9d0e1f"] }
```

The server verifies each file actually landed in R2 with the declared
size/type, flips the entries to `UPLOADING`, and enqueues the background
LinkedIn upload.

Response `202`, same shape as the old media endpoint:

```json
{
  "statusCode": 202,
  "message": "Media upload started",
  "data": [
    {
      "id": "3f1c9a1e-6c9d-4e0f-9d2a-6f7b8c9d0e1f",
      "type": "IMAGE",
      "title": "photo.jpg",
      "altText": "photo.jpg",
      "status": "UPLOADING"
    }
  ]
}
```

Partial confirms are allowed: if one PUT failed, confirm the ones that
succeeded and re-initiate the failed file (after its slot expires, or
immediately — a new initiate is blocked only while another batch is `PENDING`
or `UPLOADING`, so wait for/confirm the current batch first).

## 5. The media `status` field

Every entry in `post.media[]` carries a status:

| Status | Meaning | Client behavior |
|---|---|---|
| `PENDING` | Slot issued; waiting for the client's PUT + confirm | Treat like `UPLOADING` in the UI (it's your own in-flight upload) |
| `UPLOADING` | Background job is transferring the file to LinkedIn | Show spinner/placeholder; disable Publish |
| `READY` | Done; `id` is now the real LinkedIn URN | Render normally; Publish allowed |
| `FAILED` | LinkedIn upload failed after 3 attempts | Show error state; offer re-upload (see §8) |
| *(absent)* | Entry predates this change | Treat exactly like `READY` |

Expired `PENDING` entries (abandoned uploads) are purged automatically the
next time anything touches the post's media (initiate, confirm, publish), so
they may briefly appear in `GET /posts/:id` — hide `PENDING` entries you don't
recognize from the current session.

## 6. Polling for completion

Unchanged from before — after the `202`, poll the post:

```
GET /posts/:id        → data.media[].status
```

Suggested cadence: every **3 s for images**, every **5 s for videos**. Images
normally settle in a few seconds; videos can take **several minutes**
(LinkedIn processes the video after upload; the worker waits up to 5 minutes
for that, plus transfer time, plus up to 2 retries with 10 s/20 s backoff). A
sane client-side ceiling before showing a "still processing" notice is ~10
minutes for video.

Stop polling when no entry is `PENDING` or `UPLOADING` anymore. Each entry
ends as either `READY` (with its `id` swapped to the LinkedIn URN) or
`FAILED`.

`GET /posts/linkedin/image/:urn` (thumbnail/download URL lookup) only works
with a real URN — **do not call it with a temp UUID** (`PENDING`/`UPLOADING`
entries).

## 7. Publishing

`POST /posts/:id/publish` and scheduled publishes enforce:

- Any entry `UPLOADING` or unexpired `PENDING` → **`409 Conflict`**, message
  `"Media uploads are still in progress. Try again shortly."` Disable the
  Publish button while an upload is in flight and treat this 409 as a
  retryable state, not an error toast.
- `FAILED` entries are **silently excluded** from the LinkedIn post payload.
  A post with one `READY` image and one `FAILED` image publishes with just the
  `READY` image. Surface this to the user before they publish (e.g. "1 of 2
  images failed to upload and won't be included").
- Expired `PENDING` entries never block publishing (they're purged).

## 8. Error cases

### `POST /posts/:id/media/uploads` (initiate)

| HTTP | Message | When |
|---|---|---|
| `400` | class-validator errors | Missing/invalid `fileName`/`mimeType`/`sizeBytes`, >20 files, `sizeBytes` > 200 MB |
| `400` | `Unsupported file type: …` / `Cannot mix images and videos in one post` / `Only one video per post is allowed` / `Unsupported image format: …` / `Post is already published` | Same media rules as before, now checked against declared metadata |
| `403` | `You are not authorized to edit this post` | Not the owner |
| `404` | `Post not found` | Bad post id |
| `409` | `A media upload is already in progress for this post` | Another batch is `PENDING` (unexpired) or `UPLOADING`. Finish/confirm it first, or wait ≤30 min for the stale slot to expire. |
| `409` | `Reconnect connected account to upload media.` | LinkedIn account disconnected/expired |

### `PUT <uploadUrl>` (direct to R2)

| HTTP | When |
|---|---|
| `403` | Signature mismatch: wrong `Content-Type`/`Content-Length` (different file than declared) or the slot expired. Re-initiate. |

### `POST /posts/:id/media/uploads/complete`

| HTTP | Message | When |
|---|---|---|
| `400` | `File for media <id> was not uploaded` | The PUT never happened or didn't finish |
| `400` | `Uploaded file for media <id> does not match the declared size or type` | Different bytes than declared |
| `404` | `Unknown media id: <id>` | Wrong/typo'd id (or the slot expired and was purged) |
| `409` | `Media <id> is not awaiting upload confirmation` | Entry already confirmed (`UPLOADING`/`READY`/`FAILED`) |
| `409` | `Upload slot expired. Re-initiate the upload.` | >30 min since initiate |
| `403`/`404`/`400`/`409` | ownership / post / published / reconnect errors as on initiate | |

**Failures after the 202** (in the background job) never surface as an HTTP
error — they appear as `status: "FAILED"` on the media entry during polling.

**Recovering from `FAILED`:** there is no endpoint to remove a media entry. A
failed entry stays on the post but never blocks publishing (it is excluded,
per §7). To retry, run the initiate → PUT → complete flow again — this appends
a new entry. Hide `FAILED` entries from the composer UI once acknowledged or
re-uploaded.

## 9. Deprecated: `PUT /posts/:id/media` (multipart)

The old endpoint still accepts `multipart/form-data` (`files` field) and
returns the same `202` + `UPLOADING` entries as before. It shares the
in-progress lock with the new flow (a `PENDING`/`UPLOADING` batch from either
path blocks both). Migrate to the presigned flow; this endpoint will be
removed in a later release.

## 10. Suggested UI flow

1. User attaches files → **initiate** → render returned `uploads` as
   local-progress placeholders (keyed by `mediaId`).
2. **PUT** each file to its `uploadUrl` in parallel, driving per-file progress
   bars from XHR `upload.onprogress`.
3. When all PUTs succeed → **complete** with all `mediaIds`. If some PUTs
   failed, complete the successful ones and offer retry for the rest.
4. Poll `GET /posts/:id` until no entry is `PENDING`/`UPLOADING`.
   `READY` → swap placeholder for the real media (image preview via
   `GET /posts/linkedin/image/:urn` with the new URN).
   `FAILED` → error state + re-upload affordance.
5. Keep Publish disabled while any entry is `PENDING`/`UPLOADING`; if the user
   races it, handle the `409` gracefully.

## 11. Compatibility notes

- Old posts have media entries **without** a `status` field — treat as `READY`.
- Media entries may now also carry `mimeType`, `sizeBytes`, and
  `pendingExpiresAt` fields (bookkeeping for `PENDING` slots) — ignore them.
- The response envelope (`statusCode` / `message` / `data`) is unchanged.
- Requires the backend worker process to be running; in environments where it
  isn't, media will remain `UPLOADING` indefinitely (backend concern, but
  useful for debugging "stuck" uploads in dev).
- Requires CORS to be configured on the R2 bucket for the app origins
  (backend/infra concern); without it, the direct PUTs fail preflight.
