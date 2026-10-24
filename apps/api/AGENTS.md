# AGENTS.md — apps/api

The NestJS backend (`@marquill/api`). Read the root [AGENTS.md](../../AGENTS.md) first; it has the repo map, the cross-app contracts, and the working rules. This file covers only the api.

## Docs

- `docs/` holds this app's architecture and product decision documents (workflow engine, artifact schema, credit system, document generation, and more). Search it by filename for the area you're changing, and read only what applies.
- `docs/api/` is the client-facing API reference that `apps/web` builds against. Update it in the same change as any endpoint change.
- `CONTEXT.md` is the domain glossary.

## Commands

Run these from `apps/api`, or from the root with `bun run --filter @marquill/api <script>`:

```bash
docker compose up -d     # from the repo root: MongoDB (27017), Redis (6379), BullMQ dashboard (8080),
                         # MinIO (S3 9000, console http://localhost:9001), Browserless (3002)

bun run dev              # HTTP server in watch mode (nest start --watch), port 3500
bun run build            # nest build -> dist/
bun run start:worker     # the worker process (node dist/workflow/workers/workflow.worker.js); build first

bun run seed:design-systems  # seed Design Systems from assets/design-systems; the API and worker refuse to boot without it
bun run typecheck        # tsc against tsconfig.build.json, i.e. exactly what ships
bun run eval:text         # POST/POLL model comparison: latency and tokens per model (spends OpenRouter budget; docs/text-eval-runbook.md)
bun run test             # Jest: all *.spec.ts under src/
bunx jest src/auth/auth.service.spec.ts   # a single file
bun run test:e2e         # end-to-end (test/jest-e2e.json)
CHROME_PATH=<chrome> bun run test:render  # real-browser document render (*.render-spec.ts); not in `check`, required before merging renderer or judge changes
bun run test:render                       # same, against the compose Browserless when BROWSERLESS_URL/BROWSERLESS_TOKEN are set (see .env.example)
bun run test:redis                        # Lua scripts against the compose Redis (*.redis-spec.ts, REDIS_URL from .env); not in `check`

bun run lint             # ESLint, report only (large existing backlog)
bun run lint:fix         # ESLint --fix; only on files you are changing
bun run format           # Prettier
```

Spec files are not covered by `typecheck` (ts-jest compiles them), and some carry stale type literals. Don't treat those errors as caused by your change.

## Architecture

This is a NestJS v11 backend that generates and schedules LinkedIn posts using AI. All HTTP routes are prefixed `api/v1`.

### Two processes

The application runs as **two separate processes**:

1. **HTTP server** (`src/main.ts`) — handles REST API requests
2. **Worker** (`src/workflow/workers/workflow.worker.ts`) — a standalone BullMQ worker that bootstraps a full NestJS `ApplicationContext` (not `NestFactory.create`) to get access to injected services. It processes these queues:
   - `workflow` — POST and POLL artifact runs (and DOCUMENT jobs enqueued before the queues split)
   - `workflow-document` — DOCUMENT artifact runs, on their own queue so a burst of documents can't hold up text runs. `WorkflowQueue.addArtifactRunJob` picks the queue with `queueNameFor(type)`; one `ArtifactRunProcessor` serves both
   - `post-schedule` — publishes LinkedIn posts at scheduled times
   - `linkedin-avatar-refresh` — refreshes expiring LinkedIn profile photos
   - `email` — transactional email via Resend
   - `media-upload` — uploads post media to LinkedIn

   **Deploy order:** a release that adds or renames a queue ships the worker first, then the API, so nothing is enqueued on a queue no worker consumes.

### AI Workflow engine

The workflow system in `src/workflow/` is a pipeline executor:

- **`buildWorkflow`** (`engine/workflow.builder.ts`) composes an ordered `WorkflowStep` list from artifact type, run kind, and the `withResearch` toggle
- **`runWorkflow`** (`engine/workflow.engine.ts`) iterates those steps and merges each handler's patch into shared typed run state
- **Step handlers** live in `src/workflow/steps/` and receive `(state, ctx)`, where `ctx` exposes narrow roles for the agent runner, artifact writer, renderer, credit meter, run record, logger, and event emitter
- Workflows are named `artifact:<type>` and contain `RESOLVE_INPUT`, optional `RESEARCH`, `GENERATE`, optional `RENDER_PDF`, and `PERSIST_VERSION`

Queue producers (`WorkflowQueue`, `ScheduleQueue`, etc.) live in `src/workflow/` and are imported by feature modules. The worker consumes from the same queues.

### LLM abstraction

`src/llm/` provides a strategy pattern:
- `LLMService.complete(...)` and `completeWithTools(...)` dispatch through the configured provider strategy
- Currently only `LLMProvider.OPENROUTER` is implemented (`strategies/openrouter.strategy.ts`)
- Prompts are defined as named constants in `src/agent/prompts/`
- `AgentRunnerService` owns research tool calls and structured artifact generation; `ResponseParserService` validates generated content against the per-artifact Zod schema

### Feature gating

`src/feature-gating/FeatureGatingService` enforces tier-based limits on `credits`, `scheduled_posts`, and `connected_accounts`. `resolveEntitlement` reads `Subscription` (Paddle-managed) once and returns the tier, with fallback to the default `Tier`, and the usage period from the same decision; tiers are cached in process (`FEATURE_TIER_CACHE_TTL_MS`). Callers that already resolved an entitlement pass it on: a launch gates through `assertLaunch`, and the worker resolves it once per job attempt for the research check and `RunCreditMeter`. Usage is tracked in the `Usage` collection keyed by `(user_id, feature, periodStart)`, and artifact runs settle LLM and web-search cost through `CreditMeterService`.

`SubscriptionAccessGuard` runs on protected routes to attach `entitlementTier`, `entitlementSource`, and `subscriptionStatus` to the request object.

### Auth flow

- **Clerk** is the only auth. `ClerkAuthGuard` (`src/auth/clerk/`) verifies the Clerk session token (the `__session` cookie, or a Bearer header) without a network call and attaches the local Mongo `User`, provisioning it on first sight (`UserProvisioningService`). A missing or invalid token is a `401`. The legacy Google OAuth login and its `access_token` JWT cookie have been removed.
- **LinkedIn OAuth2** → `AuthService.createLinkedinOath` issues a random, single-use `state` nonce stored in Redis (`auth:linkedin:oauth-state:*`, 10-minute TTL) and mapped to the user; `AuthService.linkedinCallback` consumes it with `GETDEL` and rejects unknown or reused states. Never put a user id in `state`. The callback stores encrypted access tokens in `ConnectedAccount` documents and supports both `PERSON` and `ORGANIZATION` account types. LinkedIn access tokens are encrypted at rest using AES-256-GCM (`EncryptionService`), requiring `ENCRYPTION_KEY` in the environment.
- The `@GetUser()` decorator extracts the authenticated user from the request.
- **Rate limiting:** every authenticated route uses `@UseGuards(ClerkAuthGuard, UserThrottlerGuard)`, in that order, so limits are counted per user (the web app's proxy makes every browser request share one IP). Counters live in Redis via `ThrottlerModule` in `app.module.ts`. Tighten expensive routes with `@Throttle(...)` and list them in `docs/api/README.md`.

### Database schemas (MongoDB via Mongoose)

Key schemas in `src/database/schemas/`:
- `User` — references a `Tier`
- `ConnectedAccount` — stores encrypted LinkedIn tokens; supports `PERSON` and `ORGANIZATION` account types with an `impersonatorUrn` linking org accounts back to the personal account
- `Artifact` — owns versioned generated content for `POST`, `POLL`, and `DOCUMENT` artifacts
- `WorkflowRun` — records asynchronous artifact generation/refinement progress, research context, and credits used; a DOCUMENT run also keeps its check results and `documentDiagnostics`
- `RunCandidateSource` — the Candidate Source text a DOCUMENT run keeps (its `acceptedCandidate` checkpoint and a failed run's last candidate), held apart from the run so a TTL index expires it after 90 days
- `Post` — a mutable `DRAFT` composition that pins an artifact version to an immutable connected account, owns uploaded image/video media, and moves through `DRAFT`, `SCHEDULED`, `PUBLISHED`, or `FAILED`
- `Subscription` — Paddle subscription state; `currentPeriodStart`/`currentPeriodEnd` drives usage period calculation
- `Tier` — holds feature `limits` map (keyed by `FeatureKey`); one tier has `isDefault: true`
- `Usage` — metered usage counters per `(user_id, feature, periodStart)`
- `DesignSystem` — one immutable Design System Version per `(id, version)` in `design_systems`, written only by `seed:design-systems`; only `status` changes after insert

## Conventions

- **Language:** TypeScript 5, target ES2023, `module`/`moduleResolution` NodeNext. Global route prefix `api/v1`; entry `src/main.ts`.
- **Structure:** feature modules under `src/`. DTOs go in `dto/`, Mongoose schemas in `src/database/schemas/`, and shared interfaces in the module root or `interfaces/`. Every folder exposes an `index.ts` barrel.
- **Imports:** absolute `src/...` imports resolve through `baseUrl`. `nest build` rewrites them to relative paths, but only when it runs under Node (see Production below).
- **Naming:** files are kebab-case (`agent.controller.ts`). Classes and interfaces are PascalCase, and interfaces have **no** `I` prefix. Variables and functions are camelCase.
- **Validation:** `class-validator` DTOs for HTTP requests (with a global `ValidationPipe`), and Zod for LLM response parsing.
- **Config:** use `@nestjs/config` and `.env` for everything. Never hardcode secrets or config values.
- **DI:** use Nest's dependency injection; avoid manual instantiation where DI is possible.
- **Types:** avoid `any`; define interfaces for complex structures.
- **Async:** `async`/`await` throughout.

## Environment variables

Copy `.env.example` and fill in real values. Required keys not in the example:
- `ENCRYPTION_KEY` — arbitrary secret used to derive the AES-256 key for LinkedIn tokens
- `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_REDIRECT_URI`
- `APIFY_API_TOKEN` — for web research via `ActorsService`
- `OPENROUTER_API_KEY` — LLM calls
- `TAVILY_API_KEY` — autonomous web research tool
- `GENERATION_MODEL`, `RESEARCH_MODEL` — OpenRouter model identifiers used by `AgentRunnerService`

Optional keys in the example (worker):
- `POST_GENERATION_MODEL`, `POLL_GENERATION_MODEL` (default `GENERATION_MODEL`; unset or blank falls back) — the OpenRouter model for POST or POLL generation and its Zod repair turn (`resolveTextGenerationModels`, `src/agent/generation-model.ts`). DOCUMENT always uses `GENERATION_MODEL`. Pick them with `bun run eval:text` (`docs/text-eval-runbook.md`).
- `TAVILY_TIMEOUT_S` (default `10`) — per-search Tavily timeout in seconds
- `TAVILY_SEARCH_DEPTH` (default `advanced`, or `basic`) — Tavily search depth
- `RESEARCH_REASONING_EFFORT`, `GENERATION_REASONING_EFFORT`, `DOCUMENT_DRAFT_REASONING_EFFORT`, `DOCUMENT_REPAIR_REASONING_EFFORT` (default unset: no effort sent) — reasoning effort for each call site of `AgentRunnerService`; an unknown value fails worker boot. Which efforts a model accepts differs per model, so check the model before setting one (see `.env.example`).
- `RESEARCH_MODE` (default `agent`, or `snippets`; anything else fails worker boot) — how `AgentRunnerService.research()` works. `agent` is the autonomous tool loop. `snippets` (`src/agent/research-snippets.ts`) is one `RESEARCH_MODEL` call at `RESEARCH_REASONING_EFFORT` (set it to the model's lowest, `none` on Luna) that returns 1–4 queries as structured output; the searches run in parallel, each that returns charges `web_search` as in the loop, and the excerpts are deduped by normalised URL, interleaved by query and capped at `RESEARCH_MAX_SNIPPETS` (default `10`) × `RESEARCH_SNIPPET_CHARS` (default `600`, both `readIntEnv`, min 1), as numbered `[n] Title (url)` findings with `mode: 'snippets'`. GENERATE labels them as raw web excerpts. `bun run eval:research` (`src/scripts/research-ab.ts`) researches fixed POST and DOCUMENT briefs in both modes and reports latency, calls, searches and findings size; it needs only `.env`, not Mongo, Redis or the worker, and spends real OpenRouter and Tavily credit.

Optional integer settings are read with `readIntEnv` (`src/common/env.ts`): unset or blank gives the default, and anything that is not a base-10 integer within bounds fails boot, naming the key.
- `MONGO_MAX_POOL_SIZE` (default `10`, min 1), `MONGO_MIN_POOL_SIZE` (default `2`, must not exceed max) — Mongo connection pool, per process (`mongoOptionsFrom` in `src/database/mongo-options.ts`). **Sizing rule:** the worker's pool must be at least its total worker concurrency + 10.
- `FEATURE_TIER_CACHE_TTL_MS` (default `60000`; `0` disables) — API and worker. How long `FeatureGatingService` caches a tier document in process. Tiers change only through the seed script, so a re-seed applies within this window; the subscription is never cached.
- `OPENROUTER_TIMEOUT_MS` (default `240000`, min 1), `OPENROUTER_MAX_ATTEMPTS` (default `3`, min 1), `OPENROUTER_RETRY_BASE_MS` (default `1000`), `OPENROUTER_RETRY_MAX_DELAY_MS` (default `15000`), `OPENROUTER_RETRY_BUDGET_MS` (default `45000`) — the app-owned retry loop in `OpenRouterStrategy` (`src/llm/strategies/openrouter-retry.ts`); the SDK's retries are off. Per try: a timeout of `min(OPENROUTER_TIMEOUT_MS, the call's timeoutMs, time left before its deadlineAt)` (research turns ask 45 s; DOCUMENT drafts and Repairs pass the run deadline). Retryable failures (`toLLMError`: 408, 429, 5xx, transport and timeout errors, provider errors after `200 OK`) sleep `Retry-After` or full jitter; a call stops when tries run out, when its total sleep would pass the budget, or when the next try would start past its deadline. A caller's abort is never retried. `OPENROUTER_MAX_ATTEMPTS=1` restores single-try behaviour. Read by both processes, so a bad value fails either boot.
- `WORKFLOW_TEXT_CONCURRENCY`, `WORKFLOW_DOCUMENT_CONCURRENCY` (default `1`, min 1; worker only) — how many jobs the `workflow` and `workflow-document` workers run at once (`workflowWorkerOptions` in `src/workflow/workers/workflow-worker-options.ts`). Production starts at 10 and 2; 2 matches the Browserless Free plan's concurrent browsers. Count both in the Mongo pool sizing rule.
- `WORKFLOW_LOCK_DURATION_MS` (default `30000`, min 1000; worker only) — the BullMQ job lock on both artifact-run queues.
- `MAX_INFLIGHT_RUNS_PER_USER` (default `0` = off, min 0; API and worker), `RUN_INFLIGHT_LEASE_SECONDS` (default `1800`, min 1) — per-user cap on artifact runs in flight (`InflightRunLimiter`, `src/workflow/inflight-run-limiter.ts`). A Redis ZSET `workflow:inflight:{userId}` holds run ids scored by lease expiry; `ArtifactGenerationService` reserves a slot (atomic Lua, Redis `TIME`) after `assertLaunch` and before any write, under the run's pre-generated `_id`. Over the cap is a `429 run.too_many_in_flight`. The slot is released on enqueue failure, run success, and terminal failure (stalled jobs included, via `onFailed`), and the worker refreshes the lease each job attempt; a run still queued when its lease runs out has lost its slot (the refresh does not re-add it), so keep the lease well above the longest queue wait. Off means no Redis calls; a Redis error never fails a run (reserve fails open).
- `BROWSERLESS_MAX_CONCURRENT_SESSIONS` (default `0`: off), `BROWSERLESS_SLOT_WAIT_MAX_MS` (default `120000`) — the Browserless slot semaphore (`RenderSlots` in `src/document-render/render-slots.ts`). Each render session holds a lease in the Redis sorted set `browserless:slots` from just before it connects until it ends, so renders across every worker stay within the plan's concurrent-browser limit and wait instead of being refused. A lease lives `RENDER_SESSION_DEADLINE_MS + BROWSERLESS_SESSION_GRACE_MS + 5 s` (75 s), so a crashed worker's slot frees itself. A render waits up to `min(BROWSERLESS_SLOT_WAIT_MAX_MS, run deadline left − 20 s)`, then fails as transient `render.unavailable` with no render attempt recorded and nothing billed; each render attempt records its `slotWaitMs`. `0` makes no Redis calls; Redis errors fail open (a warning, and the render goes ahead). **Production on Browserless Free: `BROWSERLESS_MAX_CONCURRENT_SESSIONS=2`.** Only the worker renders, but both processes read the keys at boot. `bun run test:redis` (`*.redis-spec.ts`, not in `check`) runs the acquire script against the compose Redis.
- `WORKER_SHUTDOWN_TIMEOUT_MS` (default `120000`; worker only) — on the first `SIGTERM` or `SIGINT` the worker stops taking jobs, lets running ones finish, waits for their failure handlers, closes the app and exits 0; past this timeout it exits 1, and the unfinished job stalls and resumes on the next worker (`worker-shutdown.ts`). The host's drain window must be longer: on Railway, `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=130` (see `docs/monorepo.md`). Start the worker with `node` directly; a package-manager wrapper can swallow `SIGTERM`.

## Production

- The same build runs two processes: `node dist/main.js` (HTTP) and `node dist/workflow/workers/workflow.worker.js` (worker).
- The working directory must be `apps/api`. Mail templates and Design Systems are read from `process.cwd()/assets`.
- `nest build` must run under Node, not Bun. Under Bun, `require.resolve` honours tsconfig's `baseUrl`, so Nest's path-rewrite hook leaves `src/...` imports bare, and `dist/` then fails with `Cannot find module 'src/...'`.
- `Dockerfile` builds the image from the repository root: `docker build -f apps/api/Dockerfile -t marquill-api .`. `docker compose --profile app up -d` (run from the root) runs the API and worker against the local infrastructure.
- Storage is S3-compatible. With `R2_ENDPOINT` set (local MinIO), the client uses path-style URLs and `R2_ACCOUNT_ID` is unused; production leaves it unset and uses Cloudflare R2. Presigned URLs point at the endpoint, so the `--profile app` value `http://minio:9000` is unreachable from the browser. Run the api on the host for flows that touch presigned URLs.

## Writing Tests

**Every new service must have a corresponding `<name>.spec.ts` file.** When creating a service, write tests for all public methods before considering the task complete. Tests live alongside the source file.

Test files are colocated with their source files as `<name>.spec.ts`. Run a single file with:

```bash
bunx jest src/auth/auth.service.spec.ts
```

### Structure

- One outer `describe('<ClassName>')` per file.
- Nest a `describe('<methodName>')` for each public method under test.
- Name `it` blocks: `"should <expected behavior> when <condition>"`.

### Service construction

Prefer manual construction over `Test.createTestingModule` for unit tests — it is faster and gives finer control:

```typescript
const service = new MyService(depA as any, depB as any, depC as any);
// or for private-constructor patterns:
const service = Object.create(MyService.prototype) as MyService;
```

Only use `Test.createTestingModule` when testing NestJS lifecycle hooks or module wiring itself.

### Factory pattern

Wrap setup in a `makeService()` factory and call it in `beforeEach`. Return `{ service, mocks, fixtures }`:

```typescript
const makeService = () => {
  const userModel = { findOne: jest.fn(), create: jest.fn() };
  const configService = { get: jest.fn((key) => envValues[key]) };
  const service = new MyService(userModel as any, configService as any);
  const fixtures = { user: { _id: new Types.ObjectId(), email: 'a@b.com' } };
  return { service, mocks: { userModel, configService }, fixtures };
};

let service: MyService;
let mocks: ReturnType<typeof makeService>['mocks'];
let fixtures: ReturnType<typeof makeService>['fixtures'];

beforeEach(() => {
  jest.clearAllMocks();
  ({ service, mocks, fixtures } = makeService());
});
```

### Mocking modules

Use `jest.mock` with `{ virtual: true }` for all module-path mocks (required for Bun compatibility):

```typescript
jest.mock('src/database/schemas', () => ({
  PostStatus: { SCHEDULED: 'SCHEDULED', PUBLISHED: 'PUBLISHED', FAILED: 'FAILED' },
  AccountProvider: { LINKEDIN: 'LINKEDIN' },
}), { virtual: true });
```

### Mongoose query chains

Mock chained Mongoose queries by composing `jest.fn()` return values:

```typescript
const exec = jest.fn().mockResolvedValue(results);
const sort = jest.fn().mockReturnValue({ exec });
const select = jest.fn().mockReturnValue({ sort });
const find = jest.fn().mockReturnValue({ select });
// Simulates: Model.find().select().sort().exec()

// For lean() pattern:
model.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(doc) });
```

### Assertions

```typescript
// Success
await expect(service.method()).resolves.toEqual(expected);

// Errors
await expect(service.method()).rejects.toThrow('message');
await expect(service.method()).rejects.toBeInstanceOf(ConflictException);
await expect(service.method()).rejects.toMatchObject({ response: { code: 'ERROR_CODE' } });

// Call verification
expect(mocks.model.save).toHaveBeenCalledTimes(1);
expect(mocks.model.updateOne).toHaveBeenCalledWith(filter, update, { upsert: true });
```

### Time-dependent tests

```typescript
const now = new Date('2026-01-01T00:00:00Z');
beforeEach(() => jest.useFakeTimers().setSystemTime(now));
afterEach(() => jest.useRealTimers());
```
