# AGENTS.md

This file provides guidance to Codex and other coding agents when working with code in this repository.

## Documentation and decision documents

The `docs/` folder contains architectural and product decision documents. When working on a task, inspect the filenames and search the folder for documents relevant to the area being changed, then read those documents before making decisions or edits.

Do not load every document by default. Read only the documents that are relevant to the current task, and expand to related documents only when their references or the code under investigation indicate they are needed.

Create and maintain repository documentation in the `docs/` folder unless a task explicitly requires a conventional file elsewhere (for example, `README.md`, `AGENTS.md`, or a colocated code comment).

## Subagents

The default subagent limit for a task is zero. Do not create or delegate work to subagents for convenience, speed, or parallelism.

Only create subagents when the user's prompt explicitly asks for them or an applicable skill's instructions explicitly require them. When subagents are authorized, create no more than the number requested; if no number is specified, use the minimum number necessary to satisfy the instruction.

## Commands

```bash
# Development
npm run start:dev        # watch mode
npm run build            # compile TypeScript via nest build

# Code quality
npm run lint             # ESLint with auto-fix
npm run format           # Prettier

# Testing
npm run test             # all unit tests (Jest, rootDir: src, pattern: *.spec.ts)
npm run test:watch       # watch mode
npm run test:cov         # with coverage
npm run test:e2e         # end-to-end (test/jest-e2e.json config)

# Run a single test file
npx jest src/auth/auth.service.spec.ts

# Worker process (separate from the HTTP server)
npm run start:worker     # node dist/workflow/workers/workflow.worker.js

# Local infrastructure
docker-compose up -d     # starts MongoDB (27017), Redis (6379), BullMQ dashboard (8080)
```

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

- **Google OAuth2** → `AuthService.validateGoogleUser` → JWT cookie
- **LinkedIn OAuth2** → `AuthService.linkedinCallback` — stores encrypted access tokens in `ConnectedAccount` documents; supports both `PERSON` and `ORGANIZATION` account types. LinkedIn access tokens are encrypted at rest using AES-256-GCM (`EncryptionService`), requiring `ENCRYPTION_KEY` in the environment.
- JWT guard (`JwtAuthGuard`) validates the `access_token` cookie on all protected routes. The `@GetUser()` decorator extracts the user from the request.

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

## Conventions (from PROJECT_RULES.md)

- **Files**: kebab-case (`agent.controller.ts`)
- **Classes/Interfaces**: PascalCase; interfaces have **no** `I` prefix
- **Variables/functions**: camelCase
- **Barrel exports**: every folder exposes an `index.ts`
- **DTOs**: in a `dto/` subfolder within the feature module, validated with `class-validator`
- **Zod** is used for LLM response parsing; `class-validator` is used for HTTP request DTOs
- Avoid `any`; define interfaces for all complex structures
- Use `@nestjs/config` + `.env` for all configuration; no hardcoded values

## Environment variables

Copy `.env.example` and fill in real values. Required keys not in the example:
- `ENCRYPTION_KEY` — arbitrary secret used to derive the AES-256 key for LinkedIn tokens
- `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_REDIRECT_URI`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`
- `APIFY_API_TOKEN` — for web research via `ActorsService`
- `OPENROUTER_API_KEY` — LLM calls
- `TAVILY_API_KEY` — autonomous web research tool
- `GENERATION_MODEL`, `RESEARCH_MODEL` — OpenRouter model identifiers used by `AgentRunnerService`

## Worktrees

Always place worktrees under `.codex/worktrees/` — this path is already gitignored.

```bash
# Create a worktree on a new branch
git worktree add .codex/worktrees/<branch-name> -b <branch-name>

# Copy all .env files from the repo root into the worktree
cp .env* .codex/worktrees/<branch-name>/

# Install dependencies in the worktree
cd .codex/worktrees/<branch-name> && bun install
```

Rules:
- After creating a worktree, always copy `.env*` files before doing any work in it — services will fail to start without them.
- Never commit worktree directories; `.codex/worktrees/` is in `.gitignore`.
- Remove stale worktrees with `git worktree remove .codex/worktrees/<branch-name>` when done.

## Writing Tests

**Every new service must have a corresponding `<name>.spec.ts` file.** When creating a service, write tests for all public methods before considering the task complete. Tests live alongside the source file.

Test files are colocated with their source files as `<name>.spec.ts`. Run a single file with:

```bash
bun jest src/auth/auth.service.spec.ts
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
