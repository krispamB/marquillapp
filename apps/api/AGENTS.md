# AGENTS.md — apps/api

The NestJS backend (`@marquill/api`). Read the root [AGENTS.md](../../AGENTS.md) first; it has the repo map, the cross-app contracts, and the working rules. This file covers only the api.

## Docs

- `docs/` holds this app's architecture and product decision documents (workflow engine, artifact schema, credit system, carousel rendering, and more). Search it by filename for the area you're changing, and read only what applies.
- `docs/api/` is the client-facing API reference that `apps/web` builds against. Update it in the same change as any endpoint change.
- `CONTEXT.md` is the domain glossary.

## Commands

Run these from `apps/api`, or from the root with `bun run --filter @marquill/api <script>`:

```bash
docker compose up -d     # from the repo root: MongoDB (27017), Redis (6379), BullMQ dashboard (8080)

bun run dev              # HTTP server in watch mode (nest start --watch), port 3500
bun run build            # nest build -> dist/
bun run start:worker     # the worker process (node dist/workflow/workers/workflow.worker.js); build first

bun run typecheck        # tsc against tsconfig.build.json, i.e. exactly what ships
bun run test             # Jest: all *.spec.ts under src/
bunx jest src/auth/auth.service.spec.ts   # a single file
bun run test:e2e         # end-to-end (test/jest-e2e.json)

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
2. **Worker** (`src/workflow/workers/workflow.worker.ts`) — a standalone BullMQ worker that bootstraps a full NestJS `ApplicationContext` (not `NestFactory.create`) to get access to injected services. It processes four queues:
   - `workflow` — AI post generation pipelines
   - `post-schedule` — publishes LinkedIn posts at scheduled times
   - `linkedin-avatar-refresh` — refreshes expiring LinkedIn profile photos
   - `email` — transactional email via Resend

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

`src/feature-gating/FeatureGatingService` enforces tier-based limits on `credits`, `scheduled_posts`, and `connected_accounts`. It resolves the user's active tier by checking `Subscription` (Paddle-managed) with fallback to the default `Tier`. Usage is tracked in the `Usage` collection keyed by `(user_id, feature, periodStart)`, and artifact runs settle LLM and web-search cost through `CreditMeterService`.

`SubscriptionAccessGuard` runs on protected routes to attach `entitlementTier`, `entitlementSource`, and `subscriptionStatus` to the request object.

### Auth flow

- **Clerk** is the primary auth. `ClerkAuthGuard` (`src/auth/clerk/`) verifies the Clerk session token (the `__session` cookie, or a Bearer header) without a network call and attaches the local Mongo `User`, provisioning it on first sight (`UserProvisioningService`). If no Clerk token is present, it falls back to the legacy passport-jwt `JwtAuthGuard`, so old `access_token` cookies keep working until they expire. That fallback is meant to be removed once legacy traffic drains.
- **Google OAuth2** (legacy) → `AuthService.validateGoogleUser` → `access_token` JWT cookie
- **LinkedIn OAuth2** → `AuthService.linkedinCallback` — stores encrypted access tokens in `ConnectedAccount` documents; supports both `PERSON` and `ORGANIZATION` account types. LinkedIn access tokens are encrypted at rest using AES-256-GCM (`EncryptionService`), requiring `ENCRYPTION_KEY` in the environment.
- The `@GetUser()` decorator extracts the authenticated user from the request.

### Database schemas (MongoDB via Mongoose)

Key schemas in `src/database/schemas/`:
- `User` — references a `Tier`
- `ConnectedAccount` — stores encrypted LinkedIn tokens; supports `PERSON` and `ORGANIZATION` account types with an `impersonatorUrn` linking org accounts back to the personal account
- `Artifact` — owns versioned generated content for `POST`, `POLL`, and `DOCUMENT` artifacts
- `WorkflowRun` — records asynchronous artifact generation/refinement progress, research context, and credits used
- `Post` — a mutable `DRAFT` composition that pins an artifact version to an immutable connected account, owns uploaded image/video media, and moves through `DRAFT`, `SCHEDULED`, `PUBLISHED`, or `FAILED`
- `Subscription` — Paddle subscription state; `currentPeriodStart`/`currentPeriodEnd` drives usage period calculation
- `Tier` — holds feature `limits` map (keyed by `FeatureKey`); one tier has `isDefault: true`
- `Usage` — metered usage counters per `(user_id, feature, periodStart)`

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
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`
- `APIFY_API_TOKEN` — for web research via `ActorsService`
- `OPENROUTER_API_KEY` — LLM calls
- `TAVILY_API_KEY` — autonomous web research tool
- `GENERATION_MODEL`, `RESEARCH_MODEL` — OpenRouter model identifiers used by `AgentRunnerService`

## Production

- The same build runs two processes: `node dist/main.js` (HTTP) and `node dist/workflow/workers/workflow.worker.js` (worker).
- The working directory must be `apps/api`. Mail and carousel templates are read from `process.cwd()/assets`.
- `nest build` must run under Node, not Bun. Under Bun, `require.resolve` honours tsconfig's `baseUrl`, so Nest's path-rewrite hook leaves `src/...` imports bare, and `dist/` then fails with `Cannot find module 'src/...'`.
- `Dockerfile` builds the image from the repository root: `docker build -f apps/api/Dockerfile -t marquill-api .`. `docker compose --profile app up -d` (run from the root) runs the API and worker against the local infrastructure.

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
