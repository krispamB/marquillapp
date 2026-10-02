# Artifacts API

Base path: `/api/v1/artifacts`. All endpoints require authentication and are owner-scoped.

An artifact is a versioned, account-agnostic piece of LinkedIn content. Supported types are `POST`, `POLL`, and `DOCUMENT`.

## `POST /artifacts`

Starts asynchronous initial generation. The server creates version `1` with status `GENERATING`, enqueues the workflow, and returns immediately.

### Request

```json
{
  "type": "POST",
  "prompt": "Write a practical LinkedIn post about reducing deployment risk",
  "withResearch": false,
  "stylePreset": "founder"
}
```

| Field | Type | Required | Notes |
|---|---|---:|---|
| `type` | `POST \| POLL \| DOCUMENT` | yes | Artifact family. |
| `prompt` | string | yes | Non-empty, maximum 2,000 characters. |
| `withResearch` | boolean | yes | Enables research for an initial run; research is tier-gated. |
| `stylePreset` | string | no | `professional`, `storytelling`, `educational`, `bold`, `contrarian`, or `founder`. |
| `theme` | string | no | Document visual theme: `bold`, `minimal`, `editorial`, or `gradient`. |

`theme` controls carousel appearance. `stylePreset` controls writing voice; they are separate fields even though both can be `bold`.

Initial generation also creates a trimmed, descriptive `title` of 1–100 characters. The title is stored as artifact library metadata, outside versioned content, and becomes visible through artifact reads after `run.completed`. Refinements preserve the existing title.

### Response: `202 Accepted`

```json
{
  "artifactId": "665f1a7f8f1e2c3d4a5b6c7d",
  "runId": "665f1a7f8f1e2c3d4a5b6c7e"
}
```

Open the SSE stream in [runs.md](./runs.md) with `runId`. The version is ready only after `run.completed`. Until then the artifact has no `currentVersion`; version 1 is an Attempt.

### Common errors

- `400` invalid body or enum value.
- `403` insufficient credits or no research access when `withResearch` is `true`.

## `POST /artifacts/:id/refine`

Starts a new AI refinement of the Current Version. It appends an Attempt: a new `GENERATING` version numbered `max(versions) + 1`. `currentVersion` does not move; it moves to the Attempt only when the Attempt becomes `READY`, at `run.completed`. If the run fails, the Attempt stays in the history as `FAILED`, with no content, and the Current Version is unchanged. A failed Attempt is never resumed or reused; refine the Current Version again instead. Version numbers are never reused.

At most one Attempt is in flight per artifact.

### Request

```json
{
  "feedback": "Make the opening sharper and add a concrete example."
}
```

`feedback` is required, non-empty, and maximum 2,000 characters. Refinement does not run a new research pass; it can reuse completed research from the artifact's prior run.

### Response: `202 Accepted`

```json
{
  "artifactId": "665f1a7f8f1e2c3d4a5b6c7d",
  "version": 2,
  "runId": "665f1a7f8f1e2c3d4a5b6c80"
}
```

`version` is the Attempt's number.

### Common errors

- `404` artifact does not exist, is deleted, or is not owned by the caller.
- `409` an Attempt is already `GENERATING`, the artifact has no `READY` version to refine, or another refine started concurrently.
- `403` insufficient credits.

## `GET /artifacts`

Lists live artifacts as lightweight summaries, newest first, with 20 results per page. Soft-deleted artifacts are excluded.

### Query parameters

| Parameter | Type | Notes |
|---|---|---|
| `type` | `POST \| POLL \| DOCUMENT` | Optional type filter. |
| `status` | `GENERATING \| READY \| FAILED` | Optional filter on the artifact's derived `status` (see below). Applied before pagination. |
| `month` | `YYYY-MM` | Optional `updatedAt` month filter. |
| `search` | string | Optional case-insensitive literal substring match against `title` and the original `source.prompt`. Surrounding whitespace is ignored. |
| `page` | positive integer | Optional one-based page; defaults to `1`. |

Search treats punctuation and regular-expression characters literally. It can be combined with every other filter, and pagination metadata reflects the matching result set.

### Response: `200 OK`

```json
{
  "statusCode": 200,
  "message": "Artifacts retrieved successfully",
  "data": [
    {
      "id": "665f1a7f8f1e2c3d4a5b6c7d",
      "type": "DOCUMENT",
      "title": "Deployment safety",
      "status": "GENERATING",
      "currentVersion": 1,
      "latestAttempt": {
        "version": 2,
        "status": "GENERATING",
        "runId": "665f1a7f8f1e2c3d4a5b6c80"
      },
      "updatedAt": "2026-07-14T10:20:30.000Z",
      "preview": {
        "commentary": "The safest deploy is the one you can undo…",
        "firstSlide": { "type": "cover", "fields": { "title": "Deployment safety" } },
        "pdfUrl": "https://signed.example/document.pdf"
      }
    }
  ],
  "filters": {
    "availableMonths": ["2026-07", "2026-06"],
    "types": ["POST", "DOCUMENT"]
  },
  "page": 1,
  "pages": 1
}
```

`preview.commentary` is a short snippet. `preview.firstSlide` and `preview.pdfUrl` are only present for documents when available. `pdfUrl` is short-lived; do not persist it as the artifact's permanent identifier. The preview is built from the Current Version only, so it is `{}` while an artifact has none.

### Current Version, latest Attempt, and status

Every artifact read reports the Current Version and the latest Attempt separately:

```ts
currentVersion?: number;
latestAttempt?: {
  version: number;
  status: 'GENERATING' | 'FAILED';
  failureCode?: RunFailureCode; // FAILED only; the same codes as run.failed in runs.md
  failureReason?: string;       // FAILED only
  runId?: string;               // the run that generates (or generated) this Attempt
};
status: 'GENERATING' | 'READY' | 'FAILED'; // derived, on summaries
```

- `currentVersion` is the newest `READY` version, omitted until the first version becomes `READY`.
- `latestAttempt` is present only when the newest version is not the Current Version: a refine in flight, a refine that failed, or a first version that has not become `READY`. Open `GET /runs/:runId/events` with its `runId` to follow an in-flight Attempt. `runId` is absent only in the instant between the Attempt being appended and its run being recorded.
- A summary's `status` is derived: `GENERATING` if an Attempt is in flight, else `READY` if a Current Version exists, else `FAILED`. A failed refine therefore leaves the artifact `READY`, with the failure in `latestAttempt`. The `?status=` filter uses the same derivation.

## `GET /artifacts/:id`

Returns a selected version in full. Without `?version=` it returns the Current Version, or the latest Attempt (with `content: {}`) when there is no Current Version. An Attempt never replaces the Current Version in this read: while a refine is in flight or after one failed, the response is still the Current Version, and the Attempt is reported in `latestAttempt`.

`currentVersion` and `latestAttempt` have the same meaning as in [`GET /artifacts`](#current-version-latest-attempt-and-status). Here `version` and `status` describe the returned version itself, not the artifact; the artifact's derived status is `GENERATING` when `latestAttempt.status` is `GENERATING`, else `READY` when `currentVersion` is present, else `FAILED`.

A version that is not `READY`, including one read with `?version=`, has `content: {}`. A `FAILED` version also carries `failureCode` and `failureReason`.

### Query parameters

| Parameter | Type | Notes |
|---|---|---|
| `version` | positive integer | Return this version instead of the Current Version. |
| `includeVersions` | `true \| false` | When true, add version metadata; history does not repeat full content. |

### Response: `200 OK`

```json
{
  "statusCode": 200,
  "message": "Artifact retrieved successfully",
  "data": {
    "id": "665f1a7f8f1e2c3d4a5b6c7d",
    "type": "POST",
    "title": "Deployment safety",
    "currentVersion": 1,
    "latestAttempt": {
      "version": 2,
      "status": "FAILED",
      "failureCode": "internal",
      "failureReason": "The model did not return a usable post.",
      "runId": "665f1a7f8f1e2c3d4a5b6c80"
    },
    "version": 1,
    "status": "READY",
    "updatedAt": "2026-07-14T10:20:30.000Z",
    "content": { "commentary": "The safest deploy is the one you can undo." },
    "versions": [
      {
        "version": 1,
        "status": "READY",
        "createdAt": "2026-07-14T10:15:00.000Z",
        "editedAt": "2026-07-14T10:20:30.000Z"
      },
      {
        "version": 2,
        "status": "FAILED",
        "createdAt": "2026-07-14T10:22:00.000Z",
        "refineFeedback": "Make the opening sharper.",
        "failureCode": "internal",
        "failureReason": "The model did not return a usable post."
      }
    ]
  }
}
```

A read of a failed version, `GET /artifacts/:id?version=2` above, returns `"version": 2`, `"status": "FAILED"`, the same `failureCode` and `failureReason`, and `"content": {}`.

`versions` is omitted unless `includeVersions=true`. `editedAt`, `refineFeedback`, `failureCode`, and `failureReason` are omitted when absent; the failure fields appear only on `FAILED` versions.

For documents, client-facing content uses a signed `document.pdfUrl`. The stored `pdfKey` is internal and is not the browser URL.

### Content shapes

```ts
type PostContent = {
  commentary: string; // 1–3,000 LinkedIn characters
};

type PollContent = {
  commentary?: string; // 1–3,000 LinkedIn characters
  poll: {
    question: string; // at most 140 LinkedIn characters
    options: string[]; // 2–4 unique options, each at most 30 characters
    durationDays: 1 | 3 | 7 | 14;
  };
};

type DocumentContent = {
  commentary?: string;
  document: {
    templateId: 'bold' | 'minimal' | 'editorial' | 'gradient';
    slides: Slide[]; // 2–15 slides
    pageCount?: number;
    pdfUrl?: string; // signed URL in GET responses
  };
};

type Slide =
  | { type: 'cover'; fields: { eyebrow?: string; title: string; subtitle?: string } }
  | { type: 'content'; fields: { heading: string; body: string } }
  | { type: 'list'; fields: { heading: string; items: string[] } }
  | { type: 'quote'; fields: { quote: string; attribution?: string } }
  | { type: 'cta'; fields: { headline: string; action: string; handle?: string } };
```

Poll options must be unique after trimming and case-folding. The server validates slide field lengths and counts when content is edited or generated.

## `PATCH /artifacts/:id`

Edits the Current Version in place. It does not create a new version. The artifact must have a Current Version and no Attempt in flight, the Current Version must not be referenced by a `SCHEDULED` or `PUBLISHED` Post, and the response stamps `editedAt`.

Preferred request envelope:

```json
{
  "title": "Deployment safety",
  "content": { "commentary": "Updated commentary" }
}
```

The endpoint also accepts content fields directly:

```json
{ "commentary": "Updated commentary" }
```

Content is merged recursively with the current content and validated as the complete type-specific shape. For documents, `pdfKey`, `pageCount`, and `pdfUrl` are derived fields; do not edit them.

When supplied, `title` is trimmed and must contain 1–100 characters.

### Response: `200 OK`

The response is the same artifact detail shape as `GET /artifacts/:id`, inside `data`, with the updated content.

### Common errors

- `400` invalid or incomplete content after merging the patch.
- `404` artifact not found, deleted, or not owned by the caller.
- `409` there is no Current Version, a refine is in flight, the Current Version is pinned by a scheduled/published Post, or it changed before the edit was saved. Unschedule first or create/refine another version instead of mutating an approved composition.

## `DELETE /artifacts/:id`

Soft-deletes an artifact. It disappears from list results and cannot be refined, edited, or posted.

### Response: `200 OK`

```json
{
  "statusCode": 200,
  "message": "Artifact deleted successfully",
  "data": {
    "id": "665f1a7f8f1e2c3d4a5b6c7d",
    "deletedAt": "2026-07-14T10:25:00.000Z"
  }
}
```

## Recommended client flow

1. Submit `POST /artifacts` or `POST /artifacts/:id/refine`.
2. Store the returned `artifactId`, `runId`, and refine `version` if present.
3. Connect to `GET /runs/:runId/events`. After a reload, `latestAttempt.runId` from `GET /artifacts/:id` finds an in-flight run again.
4. On `run.completed`, refetch `GET /artifacts/:id?version=<version>`.
5. Allow manual edits only to the Current Version, and only while no Attempt is `GENERATING`.
6. Bind the artifact version to LinkedIn with `POST /posts`.
