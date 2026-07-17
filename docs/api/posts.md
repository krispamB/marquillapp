# Posts API

Base path: `/api/v1/posts`. All endpoints require authentication and are owner-scoped.

Posts bind one artifact version to one usable LinkedIn connected account. The artifact stays in the library and can be posted again with another account or version.

## `POST /posts`

Creates a post binding. Without `scheduledAt`, the server publishes immediately. With a future `scheduledAt`, it creates a scheduled post and queues it.

### Request

```json
{
  "artifactId": "665f1a7f8f1e2c3d4a5b6c7d",
  "version": 2,
  "connectedAccount": "665f1a7f8f1e2c3d4a5b6c90",
  "scheduledAt": "2026-07-15T09:00:00.000Z"
}
```

| Field | Type | Required | Notes |
|---|---|---:|---|
| `artifactId` | Mongo ID | yes | Must belong to the caller. |
| `version` | positive integer | no | Defaults to the artifact's current version; it must be `READY`. |
| `connectedAccount` | Mongo ID | yes | Must be an owned, active LinkedIn account with an access token. |
| `scheduledAt` | ISO date | no | If present, must be in the future. Without it, publish immediately. |

Organization accounts are subject to company-page entitlement checks. Scheduling is subject to the user's scheduled-post quota.

### Response: `201 Created`

```json
{
  "statusCode": 201,
  "message": "Post created successfully",
  "data": {
    "_id": "665f1a7f8f1e2c3d4a5b6ca0",
    "user": "665f1a7f8f1e2c3d4a5b6c01",
    "connectedAccount": "665f1a7f8f1e2c3d4a5b6c90",
    "artifacts": [{ "artifact": "665f1a7f8f1e2c3d4a5b6c7d", "version": 2 }],
    "status": "SCHEDULED",
    "scheduledAt": "2026-07-15T09:00:00.000Z",
    "createdAt": "2026-07-14T10:30:00.000Z",
    "updatedAt": "2026-07-14T10:30:00.000Z"
  }
}
```

`data` is `PUBLISHED` (with `publishedAt` and usually `channelPostId`) when publishing immediately, or `SCHEDULED` when `scheduledAt` is provided.

### Common errors

- `400` selected artifact version is not `READY`, date is not in the future, or the connected account is not LinkedIn.
- `403` artifact/account is not owned, company-page access is unavailable, or another feature gate denies the operation.
- `404` artifact or connected account does not exist.
- `409` the account needs to be reconnected.

## `POST /posts/:id/publish`

Publishes an existing `SCHEDULED` or `FAILED` post immediately. Any existing schedule job is removed first. A published post cannot be published again.

### Response: `200 OK`

```json
{
  "statusCode": 200,
  "message": "Post published successfully",
  "data": {
    "_id": "665f1a7f8f1e2c3d4a5b6ca0",
    "status": "PUBLISHED",
    "publishedAt": "2026-07-14T10:35:00.000Z",
    "channelPostId": "urn:li:share:..."
  }
}
```

If LinkedIn publishing fails, the post is recorded as `FAILED` with `failureReason`; retry by calling this endpoint again after fixing the account or content problem.

## `POST /posts/:id/schedule`

Schedules or reschedules an existing `SCHEDULED` or `FAILED` post. The request replaces `scheduledAt` and removes the prior queue job.

### Request

```json
{ "scheduledAt": "2026-07-16T14:30:00.000Z" }
```

`scheduledAt` is required, must be an ISO date, and must be in the future.

### Response: `200 OK`

The response envelope contains the updated post with `status: "SCHEDULED"` and the new `scheduledAt`.

### Common errors

- `400` post is `PUBLISHED`, is not schedulable, or the date is not in the future.
- `403` post is not owned by the caller.
- `404` post does not exist.
- `409` account access/reconnection or scheduled-post quota problem.

## `GET /posts`

Lists the caller's posts, newest first, with up to 20 records per page.

### Query parameters

| Parameter | Type | Notes |
|---|---|---|
| `connectedAccount` | Mongo ID | Optional account filter. |
| `status` | `SCHEDULED \| PUBLISHED \| FAILED` | Optional status filter. |
| `month` | `YYYY-MM` | Optional `updatedAt` month filter. |
| `page` | positive integer | Optional one-based page; defaults to `1`. |

### Response: `200 OK`

```json
{
  "statusCode": 200,
  "message": "Posts retrieved successfully",
  "data": [
    {
      "_id": "665f1a7f8f1e2c3d4a5b6ca0",
      "connectedAccount": "665f1a7f8f1e2c3d4a5b6c90",
      "artifacts": [{ "artifact": "665f1a7f8f1e2c3d4a5b6c7d", "version": 2 }],
      "status": "PUBLISHED",
      "publishedAt": "2026-07-14T10:35:00.000Z",
      "channelPostId": "urn:li:share:...",
      "createdAt": "2026-07-14T10:30:00.000Z",
      "updatedAt": "2026-07-14T10:35:00.000Z"
    }
  ],
  "filters": {
    "availableMonths": ["2026-07", "2026-06"],
    "connectedAccountIds": ["665f1a7f8f1e2c3d4a5b6c90"]
  }
}
```

The current response does not include `page` or `pages`; keep the requested page in client state. `data` contains raw post records with artifact references, not full artifact content. Use `GET /posts/:id` for resolved detail.

## `GET /posts/:id`

Returns one owned post and resolves each artifact reference into source artifact metadata and the selected version.

```json
{
  "statusCode": 200,
  "message": "Post retrieved successfully",
  "data": {
    "_id": "665f1a7f8f1e2c3d4a5b6ca0",
    "connectedAccount": {
      "_id": "665f1a7f8f1e2c3d4a5b6c90",
      "displayName": "Ada Lovelace",
      "accountType": "PERSON"
    },
    "status": "PUBLISHED",
    "artifacts": [
      {
        "artifact": {
          "_id": "665f1a7f8f1e2c3d4a5b6c7d",
          "type": "POST",
          "title": "Deployment safety",
          "currentVersion": 2,
          "source": {
            "prompt": "Write about deployment safety",
            "withResearch": false,
            "stylePreset": "founder"
          }
        },
        "version": {
          "version": 2,
          "status": "READY",
          "content": { "commentary": "The safest deploy is the one you can undo." },
          "createdAt": "2026-07-14T10:20:00.000Z"
        }
      }
    ]
  }
}
```

The resolved version is the exact version bound to the post, not necessarily the artifact's current version. For document previews and signed PDF URLs, prefer `GET /artifacts/:id?version=<version>`.

The populated `connectedAccount` contains only its ID, display name, and
`PERSON` or `ORGANIZATION` account type. Credentials and profile metadata are
never included.

## `GET /posts/comparison`

Compares the number of owned Post records created in two UTC calendar months.
All statuses are counted. The months do not need to be adjacent.

### Query parameters

| Parameter       | Type      | Required | Notes                                  |
| --------------- | --------- | -------: | -------------------------------------- |
| `currentMonth`  | `YYYY-MM` |      yes | Month displayed as the current period. |
| `previousMonth` | `YYYY-MM` |      yes | Month used as the comparison baseline. |

### Response: `200 OK`

```json
{
  "statusCode": 200,
  "message": "Post comparison retrieved successfully",
  "data": {
    "current": { "month": "2026-07", "count": 7 },
    "previous": { "month": "2026-06", "count": 3 },
    "difference": 4,
    "percentageChange": 133.33
  }
}
```

`difference` is current minus previous. `percentageChange` is rounded to two
decimal places and is `null` when the previous count is zero.

## `DELETE /posts/:id`

Deletes a post record. For `SCHEDULED` posts, the schedule job is removed first. For `PUBLISHED` posts, the server also attempts to delete the LinkedIn post when the account is usable and a `channelPostId` exists.

### Response: `200 OK`

```json
{
  "statusCode": 200,
  "message": "Post deleted successfully"
}
```

Deleting a published post can return `409` if the LinkedIn account must be reconnected to safely remove the external post.

## `GET /posts/metrics/:connectedAccountId`

Returns post counts for the selected owned connected account over the most recent six months. Counts are grouped by post `createdAt` and include all post statuses.

### Response: `200 OK`

```json
{
  "statusCode": 200,
  "message": "Post metrics retrieved successfully",
  "data": {
    "total": 12,
    "monthly": [
      { "month": "2026-02", "count": 1 },
      { "month": "2026-07", "count": 4 }
    ]
  }
}
```

`monthly` is sorted oldest to newest among months that contain posts. Empty months are omitted.

## `GET /posts/linkedin/image/:urn`

Retained LinkedIn image proxy. The server uses the caller's connected LinkedIn account and returns a short-lived LinkedIn download URL.

### Response: `200 OK`

```json
{
  "statusCode": 200,
  "message": "Image details retrieved successfully",
  "data": {
    "downloadUrl": "https://media.licdn.com/...",
    "downloadUrlExpiresAt": 1752503600000
  }
}
```

The `urn` path segment is URL-encoded by the client. A disconnected account returns `409`; LinkedIn lookup failures return `500`.

## Post status model

```ts
type PostStatus = 'SCHEDULED' | 'PUBLISHED' | 'FAILED';
```

- `SCHEDULED`: queued for a future publish time.
- `PUBLISHED`: LinkedIn accepted the post; `publishedAt` and usually `channelPostId` are set.
- `FAILED`: a publish attempt failed; `failureReason` explains the last failure. The post can be retried with `/publish` or rescheduled with `/schedule` when fixed.
