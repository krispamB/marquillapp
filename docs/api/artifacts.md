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

### Response: `202 Accepted`

```json
{
  "artifactId": "665f1a7f8f1e2c3d4a5b6c7d",
  "runId": "665f1a7f8f1e2c3d4a5b6c7e"
}
```

Open the SSE stream in [runs.md](./runs.md) with `runId`. The version is ready only after `run.completed`.

### Common errors

- `400` invalid body or enum value.
- `403` insufficient credits or no research access when `withResearch` is `true`.

## `POST /artifacts/:id/refine`

Starts a new AI refinement against the current usable version. It appends a version, increments `currentVersion`, and returns the new version number and run ID.

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

### Common errors

- `404` artifact does not exist, is deleted, or is not owned by the caller.
- `409` the current version is still `GENERATING`, or another refine changed the artifact concurrently.
- `403` insufficient credits.

## `GET /artifacts`

Lists live artifacts as lightweight summaries, newest first, with 20 results per page. Soft-deleted artifacts are excluded.

### Query parameters

| Parameter | Type | Notes |
|---|---|---|
| `type` | `POST \| POLL \| DOCUMENT` | Optional type filter. |
| `status` | `GENERATING \| READY \| FAILED` | Optional current-version status filter. |
| `month` | `YYYY-MM` | Optional `updatedAt` month filter. |
| `page` | positive integer | Optional one-based page; defaults to `1`. |

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
      "status": "READY",
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

`preview.commentary` is a short snippet. `preview.firstSlide` and `preview.pdfUrl` are only present for documents when available. `pdfUrl` is short-lived; do not persist it as the artifact's permanent identifier.

## `GET /artifacts/:id`

Returns a selected version in full. Without query parameters it returns the artifact's current version.

### Query parameters

| Parameter | Type | Notes |
|---|---|---|
| `version` | positive integer | Return this version instead of `currentVersion`. |
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
    "version": 1,
    "status": "READY",
    "updatedAt": "2026-07-14T10:20:30.000Z",
    "content": { "commentary": "The safest deploy is the one you can undo." },
    "versions": [
      {
        "version": 1,
        "status": "READY",
        "createdAt": "2026-07-14T10:15:00.000Z",
        "editedAt": "2026-07-14T10:20:30.000Z",
        "refineFeedback": "Make the opening sharper."
      }
    ]
  }
}
```

`versions` is omitted unless `includeVersions=true`. `editedAt` and `refineFeedback` are omitted when absent.

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

Edits the current version in place. It does not create a new version. The current version must be `READY`; the response stamps `editedAt`.

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

### Response: `200 OK`

The response is the same artifact detail shape as `GET /artifacts/:id`, inside `data`, with the updated content.

### Common errors

- `400` invalid or incomplete content after merging the patch.
- `404` artifact not found, deleted, or not owned by the caller.
- `409` current version is not `READY`, or changed before the edit was saved.

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
3. Connect to `GET /runs/:runId/events`.
4. On `run.completed`, refetch `GET /artifacts/:id?version=<version>`.
5. Allow manual edits only when the returned version is `READY`.
6. Bind the artifact version to LinkedIn with `POST /posts`.
