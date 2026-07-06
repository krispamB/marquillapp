# Handoff: Async LinkedIn Media Upload (client-side changes)

**Branch:** `fix/linkedin-image-upload` · **Date:** 2026-07-06

Media upload used to be synchronous: `PUT /posts/:id/media` uploaded to LinkedIn
inline and returned only when everything (including LinkedIn's video
processing) was done — which is why large uploads died with connection
timeouts around 30 seconds. Uploads are now **asynchronous**: the endpoint
stores the files, returns immediately with `202 Accepted`, and a background
worker performs the LinkedIn upload. The client must now track media status
and gate the publish action on it.

All paths below are relative to the API prefix `api/v1`.

---

## 1. What changed at a glance

| | Before | After |
|---|---|---|
| `PUT /posts/:id/media` HTTP status | `200` | `202` |
| Response `data` | none | array of pending media entries |
| Media entry `id` | final LinkedIn URN | temp UUID until upload finishes, then replaced by the URN |
| Media entry `status` | did not exist | `UPLOADING` → `READY` \| `FAILED` |
| Publish during upload | impossible (request blocked) | rejected with `409` until media is `READY` |
| Request duration | up to minutes (usually timed out) | fast — file transfer to the server + a queue write |

The **request format is unchanged**: `multipart/form-data`, field name `files`,
up to 20 files, 200 MB per-file limit, JPEG/PNG images **or** exactly one
video, no mixing images and videos in one request.

## 2. New response of `PUT /posts/:id/media`

```json
// HTTP 202
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

- `id` is a **temporary UUID**. When the background upload succeeds it is
  replaced server-side by the LinkedIn URN (`urn:li:image:…` /
  `urn:li:video:…`). Do not cache or persist the temp id beyond the polling
  loop; re-read it from the post.
- `type` is `IMAGE` or `VIDEO`. Videos have no `altText`.

## 3. The media `status` field

Every entry in `post.media[]` now carries a status:

| Status | Meaning | Client behavior |
|---|---|---|
| `UPLOADING` | Background job is transferring the file to LinkedIn | Show spinner/progress placeholder; disable Publish |
| `READY` | Uploaded; `id` is now the real LinkedIn URN | Render normally; Publish allowed |
| `FAILED` | Upload failed after 3 attempts | Show error state; offer re-upload (see §6) |
| *(absent)* | Entry predates this change | Treat exactly like `READY` |

## 4. Polling for completion

There is no webhook/SSE yet — poll the post:

```
GET /posts/:id        → data.media[].status
```

Suggested cadence: every **3 s for images**, every **5 s for videos**. Budget
expectations: images normally settle in a few seconds; videos can take
**several minutes** (LinkedIn processes the video after upload; the worker
waits up to 5 minutes for that, plus transfer time, plus up to 2 retries with
10 s/20 s backoff on failure). A sane client-side ceiling before showing a
"still processing" notice is ~10 minutes for video.

Stop polling when no entry is `UPLOADING` anymore. Each entry ends as either
`READY` (with its `id` swapped to the LinkedIn URN) or `FAILED`.

`GET /posts/linkedin/image/:urn` (thumbnail/download URL lookup) only works
with a real URN — **do not call it while an entry is still `UPLOADING`**; the
temp UUID will error.

## 5. Publishing

`POST /posts/:id/publish` and scheduled publishes now enforce:

- Any entry `UPLOADING` → **`409 Conflict`**, message
  `"Media uploads are still in progress. Try again shortly."` The client
  should disable the Publish button while it knows an upload is in flight, and
  treat this 409 as a retryable state, not an error toast.
- `FAILED` entries are **silently excluded** from the LinkedIn post payload.
  A post with one `READY` image and one `FAILED` image publishes with just the
  `READY` image. Surface this to the user before they publish (e.g. "1 of 2
  images failed to upload and won't be included").

## 6. Error cases on `PUT /posts/:id/media`

| HTTP | Message (in `message`) | When |
|---|---|---|
| `409` | `A media upload is already in progress for this post` | A previous batch on this post is still `UPLOADING`. Wait for it to finish (poll), then retry. **New.** |
| `400` | `No files provided` / `Cannot mix images and videos in one post` / `Only one video per post is allowed` / `Unsupported image format: …` / `Post is already published` | Same validations as before |
| `403` | `You are not authorized to edit this post` | Not the owner |
| `404` | `Post not found` | Bad post id |
| `409` | `Reconnect connected account to upload media.` | LinkedIn account disconnected/expired |

Failures **after** the 202 (i.e., in the background job) never surface as an
HTTP error on the upload request — they appear as `status: "FAILED"` on the
media entry during polling.

**Recovering from `FAILED`:** there is currently no endpoint to remove a media
entry. A failed entry stays on the post but never blocks publishing (it is
excluded, per §5). To retry, simply upload the file again — this appends a new
entry. The failed one remains visible in `post.media[]`; hide `FAILED` entries
from the composer UI once the user has acknowledged them, or after a
successful re-upload.

## 7. Suggested UI flow

1. User attaches files → `PUT /posts/:id/media` → on `202`, render the
   returned entries as uploading placeholders (keyed by the temp `id`).
2. Poll `GET /posts/:id`; reconcile `media[]` by position/temp-id until no
   entry is `UPLOADING`.
3. `READY` → swap placeholder for the real media (fetch image preview via
   `GET /posts/linkedin/image/:urn` using the new URN).
   `FAILED` → error state + re-upload affordance.
4. Keep Publish disabled while any entry is `UPLOADING`; if the user races it,
   handle the `409` gracefully.

## 8. Compatibility notes

- Old posts have media entries **without** a `status` field — treat as `READY`.
- The response envelope (`statusCode` / `message` / `data`) is unchanged; only
  the status code, message text, and presence of `data` on the media endpoint
  changed.
- Requires the backend worker process to be running; in environments where it
  isn't, media will remain `UPLOADING` indefinitely (backend concern, but
  useful for debugging "stuck" uploads in dev).
