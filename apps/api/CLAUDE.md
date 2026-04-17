# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

- **`WorkflowDefinition`** (`engine/workflow.types.ts`) is just an ordered list of `WorkflowStep` enum values
- **`WorkflowRegistry`** (`engine/workflow.registory.ts`) maps workflow names to their definitions
- **`runWorkflow`** (`engine/workflow.engine.ts`) iterates the steps, calling each step handler with a shared `state` object that accumulates results across steps
- **Step handlers** live in `src/workflow/steps/` and receive `(state, job, ctx)` where `ctx` contains injected services (`agentService`, `logger`)
- The two concrete workflows are `quickPostLinkedin` and `insightPostLinkedin` (in `workflows/`)

Queue producers (`WorkflowQueue`, `ScheduleQueue`, etc.) live in `src/workflow/` and are imported by feature modules. The worker consumes from the same queues.

### LLM abstraction

`src/llm/` provides a strategy pattern:
- `LLMService.generateCompletions(provider, messages, options?)` dispatches to the correct strategy
- Currently only `LLMProvider.OPENROUTER` is implemented (`strategies/openrouter.strategy.ts`)
- Prompts are defined as named constants in `src/agent/prompts/`
- LLM responses are parsed with `ResponseParserService` which extracts typed objects from raw text

### Feature gating

`src/feature-gating/FeatureGatingService` enforces tier-based limits on three features: `ai_drafts`, `scheduled_posts`, and `connected_accounts`. It resolves the user's active tier by checking `Subscription` (Paddle-managed) with fallback to the default `Tier`. Usage is tracked in the `Usage` collection keyed by `(user_id, feature, periodStart)`.

`SubscriptionAccessGuard` runs on protected routes to attach `entitlementTier`, `entitlementSource`, and `subscriptionStatus` to the request object.

### Auth flow

- **Google OAuth2** → `AuthService.validateGoogleUser` → JWT cookie
- **LinkedIn OAuth2** → `AuthService.linkedinCallback` — stores encrypted access tokens in `ConnectedAccount` documents; supports both `PERSON` and `ORGANIZATION` account types. LinkedIn access tokens are encrypted at rest using AES-256-GCM (`EncryptionService`), requiring `ENCRYPTION_KEY` in the environment.
- JWT guard (`JwtAuthGuard`) validates the `access_token` cookie on all protected routes. The `@GetUser()` decorator extracts the user from the request.

### Database schemas (MongoDB via Mongoose)

Key schemas in `src/database/schemas/`:
- `User` — references a `Tier`
- `ConnectedAccount` — stores encrypted LinkedIn tokens; supports `PERSON` and `ORGANIZATION` account types with an `impersonatorUrn` linking org accounts back to the personal account
- `PostDraft` — the draft post, with `status` (`DRAFT` | `SCHEDULED` | `PUBLISHED`) and a `connectedAccount` reference
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
- `GOOGLE_API_KEY` — YouTube Data API key (used by `AgentService`)
- `APIFY_API_TOKEN` — for web research via `ActorsService`
- `OPENROUTER_API_KEY` — LLM calls
