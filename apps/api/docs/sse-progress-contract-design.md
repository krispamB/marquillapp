# SSE Progress Contract — Design

> Status: design spec for wayfinder map #99, ticket #107 (grilling outcome).
> Author: generated for Christopher Pam. Decisions settled in a grilling session
> on 2026-07-09.
> Blocked by: #103 (workflow engine), which is closed. This ticket turns the
> engine's **internal** emission contract (#103 §5–6) into the **client-facing**
> SSE contract.

Feeds the final spec assembly (#110). Interlocking tickets are referenced inline
at each boundary.

## Framing (charter-derived givens)

- **The engine is the producer; #107 is the transport.** #103 fixed the internal
  emission contract: a `RunEvent { runId, seq, type, ts, data }` envelope
  (#103 §6), a per-run channel/log keyed `workflow:run:{runId}`, an
  engine-assigned monotonic `seq` starting at 1, and the event vocabulary in
  #103 §5. **#107 owns everything client-facing:** the SSE endpoint, wire format
  and event naming, `Last-Event-ID` replay, heartbeats, retention, and the
  proxy/compression concerns. This doc does **not** redesign the vocabulary — it
  adopts #103 §5 verbatim as the client schema and specifies how it reaches the
  browser.
- **Two processes, one relay hop** (AGENTS.md architecture). The engine runs in
  the **BullMQ worker**; the SSE endpoint lives on the **HTTP server**. They
  share Redis (`ioredis`, `REDIS_URL`, `RedisService`). So the wire is:
  `worker step → Redis (per-run log) → HTTP-server relay → EventSource`. #103 §6
  already put the durable per-run event log in Redis precisely so the HTTP server
  can relay without a direct worker link.
- **Native `EventSource`, cookie auth.** The client is a browser `EventSource`,
  which (a) can send **only cookies**, no custom headers, and (b)
  **auto-reconnects** with a `Last-Event-ID` header. Both facts drive the design.
  The existing `ClerkAuthGuard` already reads the `__session` **cookie**
  first (`clerk-auth.guard.ts:62`), so it works with `EventSource` unchanged — no
  header-token scheme needed. *(The #107 issue says "JWT cookie"; the repo has
  since moved to the Clerk `__session` cookie with a legacy `access_token`
  fallback. The guard is cookie-first either way, which is what matters here.)*

The lifecycle a single connection streams:

```
(connect, replay backlog) → run.started → step.started/…/step.completed × N
                          → usage.tick × M  → run.completed | run.failed → (close)
        ↑ heartbeats (: comment) interleaved throughout idle gaps
```

---

## 1. Endpoint shape & auth

**`GET /runs/:runId/events`** — one SSE stream per generation run.

- **Keyed by `runId`, not artifact.** The kickoff responses already hand the
  client a `runId` (`202 {artifactId, runId}` on create, `202 {artifactId,
  version, runId}` on refine — #102 §6/§8, #103 §11). `runId` is the `_id` of the
  `WorkflowRun` (#103 §4) and the Redis log key, so it is the natural, minimal
  handle. A run belongs to exactly one artifact/version, so nothing is lost.
- **Guard:** `@UseGuards(ClerkAuthGuard)` — the `__session` cookie rides along
  automatically on the `EventSource` request (same-origin, or cross-origin with
  `withCredentials: true` + CORS `credentials`).
- **Owner scoping:** load the `WorkflowRun` by `:runId`; **403** if
  `run.user !== req.user._id` (same owner-check pattern as `PostService` /
  #102 §8). **404** if no such run. Do this *before* opening the stream so
  auth/ownership failures are ordinary JSON HTTP errors, not mid-stream events.
- **Transport handler style — raw `@Res()`, not `@Sse()`.** NestJS's `@Sse()`
  wraps an `Observable<MessageEvent>` and is lovely for a fixed rxjs source, but
  this endpoint needs four things that fight that abstraction:
  1. read the inbound `Last-Event-ID` header to seek the replay cursor,
  2. short-circuit with **HTTP 204** on reconnect to an already-finished run
     (§5) — a status decision that must happen *before* any stream body,
  3. set anti-buffering headers per-response (§7), and
  4. drive an imperative `XREAD BLOCK` loop (§4) whose cadence also produces
     heartbeats.

  A raw `@Res({ passthrough: false })` handler maps cleanly onto all four
  (`res.writeHead(...)`, `res.write(...)`, `req.on('close', …)`), so #107 uses
  raw `res`. `@Sse()` is the rejected alternative below.

**Rejected — `@Sse()` Observable handler.** Simpler for the happy path, but it
owns the status line and content-type before we can inspect `Last-Event-ID` or
return 204, and it hides the `res` we need for the anti-buffer headers. We'd end
up fighting it on every one of the four points above.

**Rejected — nest the route under `/artifacts/:id/...`.** Redundant: `runId`
already uniquely identifies the run and its artifact; the extra path segment adds
a second thing to validate for no gain.

**Rejected — WebSocket (`socket.io` is already a dependency).** Progress is
**server→client, one-way, per-run, short-lived**. SSE gives us native
auto-reconnect + `Last-Event-ID` replay for free over plain HTTP/cookies; a
socket adds a bidirectional channel, its own auth handshake, and room management
we don't need. (`socket.io` stays for whatever it's currently used for; it is not
the progress transport.)

## 2. Wire format & the SSE envelope

Each `RunEvent` (#103 §6) is serialized to one SSE message:

```
id: <redis-stream-entry-id>
event: <RunEventType>            # e.g. step.completed
data: <JSON of the event body>   # single line; see §3
                                 # (blank line terminates the message)
```

- **`event:`** = the `RunEventType` from #103 §5 verbatim (`run.started`,
  `step.started`, …). The client attaches typed listeners
  (`es.addEventListener('step.completed', …)`) instead of switching inside a
  single `onmessage`.
- **`data:`** = `JSON.stringify` of `{ seq, ts, ...data }` — the engine's
  per-event `data` payload (#103 §5) plus `seq` and `ts` lifted in so the client
  gets ordering/timing without a separate envelope. JSON is emitted on a **single
  `data:` line** (no embedded newlines) to stay within one SSE record.
- **`id:` = the Redis Stream entry ID**, not the raw `seq`. This is the one
  refinement of #103 §6, which flagged `seq` as "the natural basis for
  `Last-Event-ID`" but explicitly left the `seq ↔ stream-ID` mapping to #107.
  Using the **stream entry ID as the SSE `id`** makes replay a trivial native
  `XREAD ... STREAMS <key> <lastEventId>` (§4/§5) with **no seq→offset index** to
  maintain. `seq` still travels **inside `data`** as the app-level monotonic
  counter, so the client can detect gaps/dedupe independently of the opaque
  transport ID.
- **`retry:`** — on connect, the server first writes a `retry: 3000` directive to
  set the `EventSource` reconnect backoff to 3 s (browser default is
  implementation-defined ~3 s; we pin it).

**Rejected — SSE `id` = `seq`.** Would force a `seq → stream-position` lookup on
every reconnect (an extra index or an `XRANGE` scan to translate). Native stream
IDs already encode order and are the argument `XREAD` wants.

## 3. Event vocabulary (client-facing schema)

Adopted from #103 §5 **unchanged** — the engine's internal names *are* the
client's event names (no translation layer to drift). The `data` shapes below are
the client contract:

| `event:` | Meaning | `data` (plus `seq`, `ts`) |
|---|---|---|
| `run.started` | Run accepted; step plan known | `{ kind, type, steps: WorkflowStep[] }` |
| `step.started` | A step began | `{ step, index, total }` |
| `step.completed` | A step finished | `{ step, index, total }` |
| `step.progress` | Fine-grained within a step (optional) | `{ step, ...signal }` e.g. `{ sourcesFound }` (#104 §7) |
| `usage.tick` | Credits consumed | `{ kind, credits, detail? }` (#105 `UsageKind`) |
| `step.failed` | Step failed **but will retry** (non-terminal) | `{ step, retryable: true, message }` |
| `run.completed` | Terminal ✔ — version is now `READY` | `{ artifactId, version }` |
| `run.failed` | Terminal ✘ | `{ failureReason }` |

- **"Artifact ready" = `run.completed`.** The issue lists "artifact ready" in the
  vocabulary; there is deliberately **no separate `artifact.ready` event**. A run
  completing *is* the target version reaching `READY` (#102 §2 — a document only
  reaches `READY` once its `pdfUrl` is rendered), so `run.completed
  {artifactId, version}` is the single, non-ambiguous "go look at it now" signal.
  The client refetches `GET /artifacts/:id?version=<version>` on this event.
- **`step.progress` is optional and step-defined.** The core never synthesizes it;
  a step emits it via `ctx.emit` only when it has a meaningful sub-signal
  (research `sourcesFound`, PDF `pageRendered`). Clients must treat it as
  best-effort UI polish, never as a required checkpoint.
- **Progress-bar math** is `index/total` from `step.started/completed`, where
  `total = steps.length` from `run.started`. Because #103 §2's builder emits an
  **honest** step list (only steps that actually run), `total` is exact — no
  skipped-step gaps in the bar.
- **Two terminal events, `run.completed` | `run.failed`.** Exactly one fires per
  run; it is always the last data event before the close handshake (§6).
  `step.failed` (`retryable: true`) is **not** terminal — it announces a
  transient blip while BullMQ retries the whole job (#103 §7), and the client
  should show "retrying…", not "failed".

**Client-side discriminated union** (the consumable schema, for a typed frontend):

```ts
type WorkflowStep =
  | 'RESOLVE_INPUT' | 'RESEARCH' | 'GENERATE' | 'RENDER_PDF' | 'PERSIST_VERSION';

type ProgressEvent =
  | { event: 'run.started';   data: { seq: number; ts: number; kind: 'INITIAL' | 'REFINE'; type: 'POST' | 'POLL' | 'DOCUMENT'; steps: WorkflowStep[] } }
  | { event: 'step.started';  data: { seq: number; ts: number; step: WorkflowStep; index: number; total: number } }
  | { event: 'step.completed';data: { seq: number; ts: number; step: WorkflowStep; index: number; total: number } }
  | { event: 'step.progress'; data: { seq: number; ts: number; step: WorkflowStep; [k: string]: unknown } }
  | { event: 'usage.tick';    data: { seq: number; ts: number; kind: string; credits: number; detail?: unknown } }
  | { event: 'step.failed';   data: { seq: number; ts: number; step: WorkflowStep; retryable: true; message: string } }
  | { event: 'run.completed'; data: { seq: number; ts: number; artifactId: string; version: number } }
  | { event: 'run.failed';    data: { seq: number; ts: number; failureReason: string } };
```

## 4. Transport — one Redis Stream per run, `XREAD BLOCK` relay

#103 §6 recommended (and deferred the final choice to #107) a **bounded Redis
Stream per run** as the durable log, with the emitter both publishing to a
pub/sub channel *and* appending to the stream. **#107 adopts the Stream as the
single source and drops the separate pub/sub relay:**

- **Key:** `workflow:run:{runId}` — a Redis **Stream** (`XADD`). Each event's
  auto-generated entry ID becomes the SSE `id` (§2).
- **The HTTP relay reads with `XREAD BLOCK`, not `SUBSCRIBE`.** For each open
  connection the relay loops:

  ```
  XREAD BLOCK <heartbeatMs> COUNT <n> STREAMS workflow:run:{runId} <cursor>
  ```

  where `cursor` starts at the replay point (§5) and advances to the last entry
  ID delivered. This **single mechanism** gives replay, live tail, and heartbeat
  cadence at once: entries returned → write them as SSE events; a block **timeout
  with no entries** → write a heartbeat comment (§6) and loop.
- **Why this beats pub/sub for SSE:** `XREAD` from a durable log has **no
  subscribe-race** (the #103 §6 hazard — events fired before a late subscriber
  attaches are simply still in the stream) and **unifies replay + live** (pub/sub
  can't replay, so it would need a *second* `XRANGE` path stitched to a live
  subscription, with a seam between them). The pub/sub channel #103 §6 mentioned
  becomes unnecessary; the engine only needs to `XADD`.
- **Per-connection Redis connection.** A blocking `XREAD` monopolizes its
  `ioredis` connection, so the relay uses `RedisService.getClient().duplicate()`
  per SSE connection and **quits it on disconnect** (`req.on('close')`). This is
  the accepted cost of blocking reads; connection count is bounded by concurrent
  viewers of in-flight runs (small — a user watches their own generation).

**Engine-side note (informs #103's implementation, not a re-decision):** #103 §6
said "the emitter both publishes and appends." Under this doc the append (`XADD`
to `workflow:run:{runId}` with `MAXLEN ~ 1000`) is the *only* required
side-effect; the pub/sub publish can be dropped.

**Rejected — pub/sub for live + `XRANGE` for replay.** Two code paths and a
hand-off seam (which events belong to replay vs live?) reintroducing exactly the
subscribe-race #103 §6 wanted gone. `XREAD BLOCK` collapses both.

**Rejected — poll the `WorkflowRun` Mongo doc.** The run record only holds coarse
`currentStep` (#103 §4), not the event stream; polling it can't deliver
`usage.tick`/`step.progress` and adds DB load. It is used **only** as the
cold-start fallback (§5), not the live path.

## 5. Reconnect semantics (`Last-Event-ID` + replay)

`EventSource` auto-reconnects and resends the last `id` it saw as the
**`Last-Event-ID`** request header. The handler (`@Headers('last-event-id')`)
branches:

- **No `Last-Event-ID` (fresh connect):** replay the **whole** stream from the
  start, then tail. Cursor = `0` (`XREAD ... STREAMS key 0`). This is what lets a
  client that connects *after* `run.started` already fired still render the full
  progress history — the backlog is in the stream.
- **With `Last-Event-ID` (reconnect):** resume **after** that entry. Cursor =
  the received ID (`XREAD ... STREAMS key <lastEventId>` returns strictly newer
  entries). No duplicates, no gap — the durable log guarantees every event
  between disconnect and reconnect is still there (within retention, §8).
- **Terminal-run short-circuit (the reconnect-loop guard):** if, at connect time,
  the run is already `COMPLETED`/`FAILED` **and** the client's `Last-Event-ID`
  already covers the terminal entry (i.e. nothing newer to send), respond
  **HTTP 204 No Content**. Per the SSE spec a `204` tells `EventSource` to
  **stop reconnecting** — this is how we prevent a finished run from being polled
  forever by a stale tab. If the run is terminal but the client is *behind*
  (missed the terminal event), we still open, replay the remaining tail including
  the terminal event, run the close handshake (§6), and let the *next* reconnect
  hit the 204.
- **Cold-start fallback (stream gone, run still known):** if the stream key has
  expired (§8) but the `WorkflowRun` doc exists, synthesize a **single snapshot**
  from the durable record (#103 §4: `status`, `currentStep`) — emit a
  `run.started` (reconstructed `steps` from `buildWorkflow(input)`) and, if
  terminal, the matching `run.completed`/`run.failed` — then close. The client
  reaches a correct final UI state even after the fine-grained log is reclaimed.
  This is exactly the "reconnect fallback" #103 §4 parked `currentStep` for.

## 6. Heartbeats & the terminal/close handshake

- **Heartbeats** — every `XREAD BLOCK` timeout with no new entries writes an SSE
  **comment line** `: hb\n\n`. Comments are ignored by `EventSource` (no event
  fires) but keep the socket and any intermediary from idling out. Cadence:
  **15 s** (the `heartbeatMs` block timeout), comfortably under the common 30–60 s
  proxy/idle timeouts. Heartbeats carry no `id`, so they never perturb
  `Last-Event-ID`.
- **Initial frame** — immediately on open, before any replay, write
  `retry: 3000\n\n` (§2) and one heartbeat comment. The early write **forces the
  response headers to flush** past any buffering proxy (§7) so the client's
  `onopen` fires promptly.
- **Close handshake** — after the terminal event (`run.completed` | `run.failed`)
  is written, the server **ends the response** (`res.end()`). Because
  `EventSource` would otherwise auto-reconnect, the client is expected to call
  `es.close()` in its `run.completed`/`run.failed` handler; the server's 204
  short-circuit (§5) is the backstop if it doesn't. There is **no bespoke `end`
  event** — the two terminal events already are the end-of-stream signal, and
  duplicating that as a third event invites clients to key off the wrong one.

## 7. Proxy-buffering & compression (the gotchas)

SSE dies silently behind anything that buffers the response. Concrete mitigations
for **this** codebase:

- **Response headers** set on the raw `res` before the first write:
  - `Content-Type: text/event-stream; charset=utf-8`
  - `Cache-Control: no-cache, no-transform` (`no-transform` also tells proxies
    not to recompress/mangle)
  - `Connection: keep-alive`
  - `X-Accel-Buffering: no` — disables **nginx** response buffering for this
    response specifically (the single most common "SSE works locally, not in
    prod" cause).
- **Disable gzip for this route.** `main.ts:17–24` registers the global
  `compression` middleware with a custom `filter`, and it **already excludes the
  streaming `/mark/chat` route** (`main.ts:20`). The SSE route is added to the
  same exclusion — compression buffers the stream to build its window and would
  stall progress:

  ```ts
  filter: (req, res) => {
    if (req.path.endsWith('/mark/chat')) return false;
    if (req.path.includes('/runs/') && req.path.endsWith('/events')) return false;
    return compression.filter(req, res);
  }
  ```

  (Equivalently, the handler can send `Content-Encoding: identity`, but reusing
  the established `filter` exclusion is the repo-idiomatic move.)
- **Flush early and often.** The initial `retry:` + heartbeat write (§6) plus
  `res.flushHeaders()` defeats connection-level buffering that waits for a first
  byte. With `X-Accel-Buffering: no` and compression off, subsequent `res.write`s
  reach the client unbuffered.
- **Explicit teardown.** `req.on('close', …)` quits the per-connection `ioredis`
  client (§4) and clears the heartbeat loop, so a closed tab or dropped proxy
  connection never leaks a blocking Redis connection.

## 8. Retention / TTL

- **`MAXLEN` on `XADD`** — the stream is capped (`XADD ... MAXLEN ~ 1000`, the
  approximate trim #103 §6 recommended). A single run emits well under 1000 events
  (5 steps × a few events + usage ticks), so the cap only bounds pathological
  runs; it is the safety valve, not the normal retention.
- **`EXPIRE` on terminal** — when the terminal event is appended, set
  `EXPIRE workflow:run:{runId} 3600` (1 h). This keeps the log around long enough
  for a client that reconnects shortly after completion to replay the full run,
  while guaranteeing reclamation. After expiry, the §5 cold-start fallback (from
  the durable `WorkflowRun`) still yields a correct final state.
- **No separate cleanup job** — `MAXLEN` bounds live size and `EXPIRE` reclaims
  finished runs, so Redis self-manages. (The `WorkflowRun` Mongo doc persists
  independently per #103 §4; SSE retention does not touch it.)

## 9. Error & edge cases

| Situation | Response |
|---|---|
| No such `runId` | `404` JSON (before stream opens) |
| Run not owned by caller | `403` JSON (before stream opens) |
| Unauthenticated | `401` via `ClerkAuthGuard` (before stream opens) |
| Run exists, not yet started (enqueued, worker not picked up) | Open stream, emit heartbeats; first real event arrives when the worker `XADD`s `run.started`. `XREAD` from `0` naturally waits. |
| Reconnect mid-run | Replay after `Last-Event-ID`, then tail (§5) |
| Reconnect after terminal, client current | `204` → client stops reconnecting (§5) |
| Reconnect after terminal, client behind | Replay tail incl. terminal, close; next reconnect → `204` |
| Stream expired, run doc present | Synthesized snapshot from `WorkflowRun`, then close (§5 fallback) |
| Stream expired, run doc gone | `404` |
| `run.failed` (terminal failure) | Delivered as a normal SSE event, **not** an HTTP error — the connection succeeded; the *run* failed. Client renders the failure from `data.failureReason`. |

- **Failures are data, not HTTP status.** Only pre-stream problems (auth,
  ownership, unknown run) are HTTP errors. Once the stream is open, everything —
  including `run.failed` — is an SSE event, so a mid-run failure never looks like
  a transport error to the client.

## 10. Client consumption (reference sketch)

```js
const es = new EventSource(`/api/v1/runs/${runId}/events`, { withCredentials: true });

es.addEventListener('run.started', (e) => initProgress(JSON.parse(e.data).steps));
es.addEventListener('step.started',   (e) => markActive(JSON.parse(e.data)));
es.addEventListener('step.completed', (e) => advance(JSON.parse(e.data)));   // index/total
es.addEventListener('usage.tick',     (e) => bumpCredits(JSON.parse(e.data)));
es.addEventListener('step.failed',    (e) => showRetrying(JSON.parse(e.data)));

es.addEventListener('run.completed', (e) => {
  const { artifactId, version } = JSON.parse(e.data);
  refetchArtifact(artifactId, version);   // now READY
  es.close();                             // deliberate close — no reconnect
});
es.addEventListener('run.failed', (e) => {
  showError(JSON.parse(e.data).failureReason);
  es.close();
});
es.onerror = () => {/* transient; EventSource auto-reconnects with Last-Event-ID */};
```

- The browser supplies `Last-Event-ID` automatically on reconnect; the client
  writes no reconnect logic. It only decides to **stop** (call `close()` on the
  terminal events).

## 11. Boundaries (owned by other tickets)

| Concern | Owner |
|---|---|
| Event vocabulary, `RunEvent` envelope, `seq` assignment, `XADD` to the per-run log | #103 |
| `usage.tick` payload (`UsageKind`, credit amounts) | #105 |
| `step.progress` signals per step (e.g. `sourcesFound`) | #104 (research) / #108 (render) |
| Artifact version → `READY` semantics the `run.completed` refetch targets | #102 |
| Kickoff endpoints returning `runId` | #102 (`POST /artifacts`, `/refine`) |
| Where credit hooks fire (source of `usage.tick`) | #103 §9 / #105 |

## 12. Migration note

Per the #100 clean write-over (relaunch, no users): this is **new surface**, no
migration. A new SSE controller (`GET /runs/:runId/events`) is added on the HTTP
server, backed by the per-run Redis Stream #103's engine already `XADD`s to.
Nothing legacy is replaced — the `PostDraft`-era flow had no progress stream (the
open issue #31 "remove draft step and change to stream" is *subsumed* by this
design). The only cross-cutting edit outside the new controller is the one-line
`compression` `filter` exclusion in `main.ts` (§7), mirroring the existing
`/mark/chat` exclusion.
