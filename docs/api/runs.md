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
| `run.completed` | `artifactId`, `version` | The version is `READY`; refetch the artifact and close the stream. |
| `run.failed` | `failureReason` | Show the failure and close the stream. |

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
  | { seq: number; ts: number; kind: 'llm' | 'web_search' | 'pdf_render'; credits: number; totalCredits: number; detail?: unknown }
  | { seq: number; ts: number; step: WorkflowStep; retryable: boolean; message: string }
  | { seq: number; ts: number; artifactId: string; version: number }
  | { seq: number; ts: number; failureReason: string };
```

The current `step.progress` signal is `sourcesFound` for `RESEARCH`. PDF rendering is atomic and does not currently emit page-level progress.

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
  const { artifactId, version } = JSON.parse(event.data);
  events.close();
  await refetchArtifact(artifactId, version);
});

events.addEventListener('run.failed', (event) => {
  renderFailure(JSON.parse(event.data).failureReason);
  events.close();
});

events.onerror = () => {
  // Temporary disconnects reconnect automatically with Last-Event-ID.
};
```
