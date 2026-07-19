# Posts API

Base path: `/api/v1/posts`. All endpoints require authentication and are owner-scoped.

A Post is a mutable publishing composition. It pins one READY artifact version to one immutable LinkedIn connected account and may carry user-uploaded image or video media. The user previews the completed composition in `DRAFT`, then explicitly publishes or schedules it.

## Create and edit a draft

### `POST /posts`

Creates a `DRAFT`. It never publishes or schedules.

```json
{
  "title": "Deployment safety launch",
  "artifactId": "665f1a7f8f1e2c3d4a5b6c7d",
  "version": 2,
  "connectedAccount": "665f1a7f8f1e2c3d4a5b6c90"
}
```

| Field | Required | Notes |
|---|---:|---|
| `title` | no | Trimmed, 1–100 characters. Defaults to the artifact title, then to the source prompt truncated to 100 characters. |
| `artifactId` | yes | Owned artifact. |
| `version` | no | Defaults to the current version; must be `READY`. |
| `connectedAccount` | yes | Owned, active LinkedIn account. It cannot be changed later. |

`scheduledAt` is rejected. Use `/schedule` after reviewing the draft.

The `201` response contains the saved Post with `status: "DRAFT"`, one pinned artifact reference, and `media: []`.

### `PATCH /posts/:id`

Partially updates the title and/or selected artifact version on a `DRAFT` or `FAILED` Post.

```json
{ "title": "Safer deployments", "artifactId": "665f1a7f8f1e2c3d4a5b6c7d", "version": 3 }
```

`title`, `artifactId`, and `version` are optional, but at least `title` or `artifactId` must be supplied. `version` is valid only with `artifactId`. An omitted title remains unchanged when replacing the artifact. Titles are trimmed and must contain 1–100 characters.

The replacement artifact must be owned and READY. A Post with uploaded media can select only a `POST` artifact because LinkedIn cannot combine uploaded media with polls or documents. Editing a `FAILED` Post returns it to `DRAFT` and clears stale failure/schedule fields.

## Uploaded media

Uploaded media is Post-owned composition data, not an Artifact. Supported compositions are up to 20 JPEG/PNG images or one MP4 video. Images and video cannot be mixed, including across separate upload batches. The application cap is 200 MB per file.

```ts
type PostMedia = {
  id: string; // stable UUID used by client routes and polling
  linkedinUrn?: string; // present after successful LinkedIn upload
  type: 'IMAGE' | 'VIDEO';
  title?: string;
  altText?: string;
  status: 'PENDING' | 'UPLOADING' | 'READY' | 'FAILED';
  mimeType?: string;
  sizeBytes?: number;
  pendingExpiresAt?: string;
};
```

### `POST /posts/:id/media/uploads`

Declares files and creates 30-minute direct-to-R2 upload slots. The Post must be editable and select a `POST` artifact.

```json
{
  "files": [
    { "fileName": "photo.jpg", "mimeType": "image/jpeg", "sizeBytes": 1048576 }
  ]
}
```

The `201` response contains `expiresAt` and `uploads[]` entries with stable `mediaId`, `uploadUrl`, and signed `requiredHeaders`. PUT each file directly to its URL using exactly those headers.

### `POST /posts/:id/media/uploads/complete`

Confirms that files reached R2, verifies their declared type/size, changes their status to `UPLOADING`, and enqueues the R2-to-LinkedIn worker.

```json
{ "mediaIds": ["3f1c9a1e-6c9d-4e0f-9d2a-6f7b8c9d0e1f"] }
```

Poll `GET /posts/:id` after the `202` response. A successful worker changes the item to `READY` and writes `linkedinUrn` without changing `id`. Retry exhaustion changes it to `FAILED`.

### `PATCH /posts/:postId/media/:mediaId`

Updates user-controlled metadata on an editable Post.

```json
{ "title": "Launch preview", "altText": "Product dashboard" }
```

`altText` is valid only for images. Identity, type, URN, and status are server-controlled.

### `DELETE /posts/:postId/media/:mediaId`

Removes one media item from an editable Post and returns the remaining array. Pending/in-flight R2 cleanup is best-effort; workers ignore items removed before completion.

### `GET /posts/:postId/media/:mediaId/preview`

Returns the expiring LinkedIn `downloadUrl` and `downloadUrlExpiresAt` for a `READY` image or video. Resolution uses the Post's exact connected account.

The older `GET /posts/linkedin/image/:urn` route remains available for compatibility, but new composer clients should use the Post/media route.

## Publish and schedule actions

### `POST /posts/:id/publish`

Publishes a `DRAFT`, `FAILED`, or `SCHEDULED` Post immediately. A pending schedule job is removed first. `PUBLISHED` is terminal.

Publishing is blocked with `409` while any media item is `PENDING`, `UPLOADING`, or `FAILED`; failed media must be removed or uploaded again. READY media is composed as one `content.media` object or an ordered `content.multiImage` object.

LinkedIn failures persist `status: "FAILED"` and `failureReason`. The Post may be edited, retried, or scheduled again.

### `POST /posts/:id/schedule`

Schedules a `DRAFT` or `FAILED` Post, or reschedules a `SCHEDULED` Post.

```json
{ "scheduledAt": "2026-07-16T14:30:00.000Z" }
```

The date must be in the future. The same media-readiness rules as immediate publishing apply. First-time scheduling consumes the existing scheduled-post quota; rescheduling and unscheduling do not refund or charge it again.

### `POST /posts/:id/unschedule`

Removes the schedule job and returns a `SCHEDULED` Post to mutable `DRAFT`. Returns `409` if the worker already owns the active job.

## Read, delete, and metrics

### `GET /posts`

Lists Posts newest first, 20 per page. Query parameters are `connectedAccount`, `status`, `month` (`YYYY-MM`), and one-based `page`. `status` accepts `DRAFT`, `SCHEDULED`, `PUBLISHED`, or `FAILED`. Filters contain `availableMonths` and `connectedAccountIds`; all statuses count.

Each artifact reference is populated with the metadata needed to label the Post while retaining its pinned version number:

```json
{
  "artifact": {
    "_id": "665f1a7f8f1e2c3d4a5b6c7d",
    "type": "POST",
    "title": "Deployment safety",
    "source": {
      "prompt": "Write a practical LinkedIn post about reducing deployment risk"
    }
  },
  "version": 2
}
```

The Post itself now carries its display `title`. The nested artifact title remains available as artifact metadata and does not change when the Post title is edited.

### `GET /posts/:id`

Returns an owned Post, its `media[]`, its safe connected-account summary, and each artifact reference resolved to the same minimal artifact metadata plus the exact pinned version payload. The artifact metadata contains only `_id`, `type`, optional `title`, and `source.prompt`.

### `DELETE /posts/:id`

Deletes the Post. Scheduled jobs are removed first. For a published Post, the server also attempts to delete the LinkedIn Post when the account is usable and a `channelPostId` exists.

### `GET /posts/comparison`

Accepts `currentMonth` and `previousMonth` (`YYYY-MM`) and compares owned Post records created in those UTC months. All statuses, including `DRAFT`, count.

### `GET /posts/metrics/:connectedAccountId`

Returns `total` and non-empty monthly counts for the most recent six months. All statuses, including `DRAFT`, count.

## Status model

```ts
type PostStatus = 'DRAFT' | 'SCHEDULED' | 'PUBLISHED' | 'FAILED';
```

- `DRAFT`: mutable artifact/media composition awaiting explicit confirmation.
- `SCHEDULED`: immutable composition queued for publication; use `/unschedule` before editing.
- `PUBLISHED`: terminal successful LinkedIn publication.
- `FAILED`: failed attempt; editable, retryable, and schedulable. Any edit returns it to `DRAFT`.

Artifact versions referenced by `SCHEDULED` or `PUBLISHED` Posts cannot be edited in place. Unschedule first or create/refine another artifact version.
