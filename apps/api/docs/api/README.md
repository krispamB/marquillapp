# Client API handoff

This is the client-facing API surface introduced or reworked by the artifact workflow branch described in [issue #111](https://github.com/krispamB/linkgenserver/issues/111).

The API is versioned under `/api/v1`:

| Area                                | Documentation                  |
| ----------------------------------- | ------------------------------ |
| Artifact library and generation     | [artifacts.md](./artifacts.md) |
| Generation progress over SSE        | [runs.md](./runs.md)           |
| Binding artifacts to LinkedIn posts | [posts.md](./posts.md)         |
| Paddle checkout and billing         | [payment.md](./payment.md)     |

## Common conventions

### Authentication

All routes in these documents require the authenticated user. Browser requests should send the Clerk `__session` cookie. During the migration, the server also accepts the legacy `access_token` cookie and a bearer token.

For a frontend hosted on a different origin, send credentials:

```ts
fetch(`${API_BASE}/artifacts`, {
  credentials: 'include',
  // ...
});
```

The SSE client must use credentials as well:

```ts
new EventSource(`${API_BASE}/runs/${runId}/events`, {
  withCredentials: true,
});
```

`API_BASE` is the server origin plus `/api/v1`, for example `https://api.example.com/api/v1`.

### IDs and dates

- Mongo IDs are 24-character hexadecimal strings.
- Dates are returned as JSON ISO-8601 strings.
- Pagination is one-based and the artifact and post list page size is 20.
- `month` filters use `YYYY-MM`.

### JSON response envelopes

Generation kickoff endpoints return their launch object directly. Library and post endpoints return the existing application envelope:

```ts
type ApiResponse<T> = {
  statusCode: number;
  message: string | unknown;
  data?: T;
  filters?: unknown;
  page?: number;
  pages?: number;
};
```

Validation and domain errors use Nest's normal HTTP error response. The useful fields are `statusCode` and `message`; validation errors may make `message` an array.

Feature limits return HTTP `403` with a structured message payload:

```json
{
  "statusCode": 403,
  "message": {
    "code": "FEATURE_LIMIT_EXCEEDED",
    "feature": "credits",
    "limit": 1000,
    "currentUsage": 1000,
    "tier": { "id": "...", "name": "..." },
    "upgradeHint": "You have used all your credits for this period. Upgrade for more."
  }
}
```

### Artifact lifecycle

An artifact is account-agnostic until it is posted. A generation or refine request creates a `GENERATING` version and returns a `runId`; the client watches that run and refetches the artifact after `run.completed`.

```text
POST /artifacts or POST /artifacts/:id/refine
        │ 202 + runId
        ▼
GET /runs/:runId/events
        │ run.completed
        ▼
GET /artifacts/:id?version=<version>
        │ status READY
        ▼
POST /posts
        │ DRAFT: attach/preview media and confirm composition
        ▼
POST /posts/:id/publish or /schedule
```

## Post composition routes

Post composition uses the current Artifact-backed Post model:

- `POST /posts` creates a `DRAFT`; it never publishes implicitly.
- `PATCH /posts/:id` changes the selected artifact/version while editable.
- `POST /posts/:id/media/uploads` and `/complete` provide direct-to-R2 media attachment.
- `PATCH`/`DELETE /posts/:postId/media/:mediaId` edit or remove attached media.
- `GET /posts/:postId/media/:mediaId/preview` resolves READY image/video previews.
- `/publish`, `/schedule`, and `/unschedule` are explicit lifecycle actions.

The following legacy routes remain removed:

- `POST /posts/:id/draft`
- `PUT /posts/:id/media`
- `GET /posts/:id/status`
