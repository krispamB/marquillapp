# Generation runs and SSE progress

## `GET /api/v1/runs/:runId/events`

Streams progress for one artifact generation or refinement run using Server-Sent Events (SSE). It is authenticated and owner-scoped.

```ts
const events = new EventSource(
  `${API_BASE}/runs/${runId}/events`,
  { withCredentials: true },
);
```

The server returns ordinary JSON HTTP errors before opening the stream:

- `401` unauthenticated.
- `403` the run belongs to another user.
- `404` the run does not exist.

Once the stream opens, a failed workflow is represented by `run.failed`, not by an HTTP error.

## SSE wire format

```text
id: 1752500000000-0
event: step.completed
data: {"seq":4,"ts":1752500000123,"step":"GENERATE","index":2,"total":4}

```

- `event` is the typed event name below.
- `data` is one-line JSON and always contains `seq` and `ts`.
- `id` is an opaque Redis stream ID. Do not parse it as the application sequence.
- `seq` is a monotonically increasing per-run sequence starting at `1`.
- The server sends `retry: 3000` on connection open.
- Heartbeats are SSE comments (`: hb`) every 15 seconds during idle periods; they do not trigger an event listener.

## Event contract

| Event | Data fields | Client behavior |
|---|---|---|
| `run.started` | `kind`, `type`, `steps` | Initialize the progress plan. |
| `step.started` | `step`, `index`, `total` | Mark the step active. |
| `step.completed` | `step`, `index`, `total` | Mark the step complete. |
| `step.progress` | `step`, plus step-specific fields | Optional UI detail; never a required checkpoint. |
| `usage.tick` | `kind`, `credits`, `totalCredits`, optional `detail` | Update the live credit display. |
| `step.failed` | `step`, `retryable`, `message` | When `retryable` is true, show a transient retry notice. When false, `run.failed` follows. |
| `run.completed` | `artifactId`, `version`, optional `content`, optional `title` | The version is `READY` and is now the artifact's `currentVersion`. POST and POLL runs also carry the promoted `content` (the same object a `GET` returns), and INITIAL runs carry `title`; render them directly and skip the refetch. DOCUMENT runs, and the snapshot of a run whose stream has expired, carry neither: refetch the artifact. Close the stream. |
| `run.failed` | `code`, `failureReason` | Show the failure and close the stream. The Attempt stays `FAILED` and the Current Version is unchanged. Retry-exhausted infrastructure failures use a client-safe generic reason. |

The possible workflow steps are `RESOLVE_INPUT`, `RESEARCH`, `GENERATE`, `RENDER_PDF`, and `PERSIST_VERSION`.

`steps` is exact for the run:

- Initial POST/POLL without research: `RESOLVE_INPUT`, `GENERATE`, `PERSIST_VERSION`.
- Initial POST/POLL with research: `RESOLVE_INPUT`, `RESEARCH`, `GENERATE`, `PERSIST_VERSION`.
- Initial DOCUMENT without research: `RESOLVE_INPUT`, `GENERATE`, `RENDER_PDF`, `PERSIST_VERSION`.
- Initial DOCUMENT with research: `RESOLVE_INPUT`, `RESEARCH`, `GENERATE`, `RENDER_PDF`, `PERSIST_VERSION`.
- Refine runs skip `RESEARCH`, even when the original artifact used research.

### Typed data examples

```ts
type WorkflowStep =
  | 'RESOLVE_INPUT'
  | 'RESEARCH'
  | 'GENERATE'
  | 'RENDER_PDF'
  | 'PERSIST_VERSION';

type RunEventData =
  | { seq: number; ts: number; kind: 'INITIAL' | 'REFINE'; type: 'POST' | 'POLL' | 'DOCUMENT'; steps: WorkflowStep[] }
  | { seq: number; ts: number; step: WorkflowStep; index: number; total: number }
  | { seq: number; ts: number; step: WorkflowStep; sourcesFound: number }
  | { seq: number; ts: number; step: 'GENERATE'; phase: 'draft' }
  | { seq: number; ts: number; step: 'GENERATE'; phase: 'repair'; round: 1 | 2; violations: number }
  | { seq: number; ts: number; step: 'RENDER_PDF'; phase: 'render'; session: number }
  | { seq: number; ts: number; step: 'RENDER_PDF'; phase: 'repair'; round: 1 | 2; violations: number }
  | { seq: number; ts: number; step: 'RENDER_PDF'; phase: 'retry'; cause: 'timeout' | 'fonts' }
  | { seq: number; ts: number; kind: 'llm' | 'web_search' | 'pdf_render'; credits: number; totalCredits: number; detail?: unknown }
  | { seq: number; ts: number; step: WorkflowStep; retryable: boolean; message: string }
  | { seq: number; ts: number; artifactId: string; version: number }
  | { seq: number; ts: number; code: RunFailureCode; failureReason: string };

type RunFailureCode =
  | 'document.repair_exhausted'
  | 'document.truncated'
  | 'design_system.unavailable'
  | 'render.unavailable'
  | 'artifact.source_missing'
  | 'internal';
```

`step.progress` signals:

- `RESEARCH`: `sourcesFound`.
- DOCUMENT `GENERATE`: `{ phase: 'draft' }` when the model starts writing the document, then `{ phase: 'repair', round, violations }` each time the model is sent the rule breaks it must fix. `round` counts the run's Repairs (at most 2 per job attempt); `violations` is how many rule breaks were found.
- DOCUMENT `RENDER_PDF`: `{ phase: 'render', session }` when a render session starts, and `{ phase: 'repair', round, violations }` each time the model is sent what the render found, or rule breaks in its fix. `round` is the same counter as in `GENERATE`: the run shares one budget of 2 Repairs per job attempt. `{ phase: 'retry', cause }` when a session timed out or a font failed to load, and the same document is rendered once more; a `render` phase with the next `session` number follows.

When a job attempt fails and BullMQ retries it, a DOCUMENT run that had reached `RENDER_PDF` resumes from the document it was rendering: `GENERATE` still sends `step.started` and `step.completed`, but no `draft` phase, and the model is not called again.

DOCUMENT progress carries counts only, never what a check found. Ignore a `phase` you do not recognise.

### Failure reason policy

Deliberate terminal failures use their stable domain reason, such as
`insufficient credits`. When a transient failure exhausts the worker's retry
budget, the worker keeps the technical cause in its server logs and emits:

```text
Generation is temporarily unavailable. Please try again.
```

Clients must not depend on provider, database, or network error text appearing
in `failureReason`.

`code` is stable and is what a client should branch on; `failureReason` is
display text. POST and POLL runs always emit `internal`. The failed Attempt
stores the same `code` and `failureReason`.

DOCUMENT runs emit these codes, each with fixed display text:

| `code` | Cause | `failureReason` |
|---|---|---|
| `document.repair_exhausted` | the generated document still broke a Design System rule after 2 Repairs, or broke a render rule (render Repairs are not built yet) | We couldn't get this design to fit cleanly. Try refining with a shorter brief or another design. |
| `document.truncated` | the document was too long to generate | This document was too long to generate. Try fewer pages or a shorter brief. |
| `design_system.unavailable` | the pinned Design System cannot be used | This design is unavailable. Try again with another design. |
| `render.unavailable` | rendering failed after retries | We couldn't render your document right now. Please try again. |
| `internal` | anything else | the generic text above |

If the artifact is deleted while its run is in flight, the run fails without
charging credits and without a `step.failed` or `run.failed` event: the client that deleted it is
no longer listening. A later reconnect to the finished run receives a synthesized
`run.failed` from the run record.

## Reconnect and close behavior

Use the browser's native `EventSource` reconnect behavior. The browser sends the last received SSE `id` as `Last-Event-ID`; the server resumes strictly after that entry.

- A fresh connection replays the complete retained run history, then follows live events.
- A reconnect resumes from `Last-Event-ID` without replaying that event.
- When a terminal event arrives, call `events.close()` in the handler. The server also closes the response.
- If a stale client reconnects after the run is terminal and already current, the server returns `204 No Content`; this tells `EventSource` to stop reconnecting.
- Completed run events are retained for approximately one hour. If the Redis stream has expired but the durable run record remains, the server sends a reconstructed snapshot containing `run.started` and the terminal event.

Example:

```ts
const events = new EventSource(
  `${API_BASE}/runs/${runId}/events`,
  { withCredentials: true },
);

events.addEventListener('run.started', (event) => {
  renderPlan(JSON.parse(event.data).steps);
});

events.addEventListener('step.started', (event) => {
  renderActiveStep(JSON.parse(event.data));
});

events.addEventListener('usage.tick', (event) => {
  renderCredits(JSON.parse(event.data).totalCredits);
});

events.addEventListener('step.failed', (event) => {
  renderRetrying(JSON.parse(event.data).message);
});

events.addEventListener('run.completed', async (event) => {
  const { artifactId, version, content, title } = JSON.parse(event.data);
  events.close();
  // `content` is optional: absent for DOCUMENT runs and snapshots, and a
  // replayed event may be stale, so fall back to the read.
  if (content && isLive(event)) renderVersion(artifactId, version, content, title);
  else await refetchArtifact(artifactId, version);
});

events.addEventListener('run.failed', (event) => {
  renderFailure(JSON.parse(event.data).failureReason);
  events.close();
});

events.onerror = () => {
  // Temporary disconnects reconnect automatically with Last-Event-ID.
};
```
