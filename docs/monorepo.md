# Monorepo layout, deployment, and migration record

On 2026-09-25, three repositories were combined into `krispamB/marquillapp`, with their full histories:

| Was | Now | History |
| --- | --- | --- |
| `krispamB/marquillapp` | `apps/web` | unchanged commits, then a move into `apps/web` |
| `krispamB/linkgenserver` | `apps/api` | rewritten into `apps/api/` and merged |
| `krispamB/incontentailanding` | `apps/landing` | rewritten into `apps/landing/` and merged |

`git log -- apps/api/src/main.ts` and `git blame` work without `--follow`, because the imported histories were rewritten with `git filter-repo --to-subdirectory-filter` and not added as a subtree. Imported commits therefore have new hashes; the originals remain in the old repositories.

## Issues and references

- All 86 issues from the two imported repositories were transferred here. Their old URLs redirect. `docs/issue-number-map.tsv` maps each old number to its new one.
- **Commit messages** in the imported history were rewritten: `#N` for a transferred issue became its new number, and `#N` for a pull request became `krispamB/linkgenserver#N` or `krispamB/incontentailanding#N`. Pull requests were not transferred, because GitHub can't transfer them.
- **Issue bodies and comments** were rewritten the same way after the transfer.
- **`apps/api` docs and code comments** had their bare issue references rewritten to the new numbers. Markdown anchors (`](#3-…)`) and hex colours were left alone.
- Anything written after the merge refers to issues in this repository.
- Open issues carry an area label: `app:api`, `app:web`, or `app:landing`.

## Tooling

- **Bun workspaces** (`apps/*` and `packages/*`) with one root `bun.lock`. `bunfig.toml` pins `linker = "hoisted"`: the isolated linker makes mongoose's transitive `mongodb` types unnameable in the api's declaration emit (TS2742), which breaks `nest build`.
- **One React version (19.2.4)** across the workspace. When web was on 19.2.3 and landing on 19.2.4, hoisting gave web two copies of React, and every hook-using component test failed with "Invalid hook call".
- **Locked versions were preserved.** When the lockfiles were merged, every direct dependency kept the version its old lockfile resolved. The only exceptions are web's React bump above and four patch-level landing devDependencies that deduplicated onto web's versions (Tailwind 4.1.17 → 4.1.18, eslint, `@types/node`).
- **Turborepo** runs `build`, `typecheck`, `lint`, `test`, and `dev` across the apps. `bun run check` runs typecheck and tests. Lint is kept out of `check` until the existing api and web lint backlog is cleared.

## Deployment

The GitHub repository for every deployment is now `krispamB/marquillapp`. Point each project at it before archiving the old repositories.

### Vercel: web

- Git repository: unchanged (`krispamB/marquillapp`)
- **Root Directory: `apps/web`**
- Framework preset: Next.js. Keep "Include files outside the root directory in the Build Step" enabled so Vercel can read the root `bun.lock`.
- Optional: set the Ignored Build Step to `npx turbo-ignore` to skip deploys when a commit doesn't touch web.

### Vercel: landing

- **Connected repository: change `krispamB/incontentailanding` → `krispamB/marquillapp`**
- **Root Directory: `apps/landing`**
- Framework preset: Next.js (`output: 'export'`). The same "include files outside the root directory" setting applies.

### Railway: api and worker

Use the Dockerfile. It is the setup verified to work: both processes were booted from the image against MongoDB and Redis.

- **API service:** set Root Directory to the repository root (`/`) and add the variable `RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile`. The image's default command, `node dist/main.js`, starts the HTTP server. `PORT` is honoured.
- **Worker service:** same repository, root, and Dockerfile, with the start command `node dist/workflow/workers/workflow.worker.js`.
- **Worker variables (optional):** `TAVILY_TIMEOUT_S` (seconds, default `10`) and `TAVILY_SEARCH_DEPTH` (`advanced` default, or `basic`) tune the research agent's web search. Only the worker reads them.
- **Research mode (worker, optional):** `RESEARCH_MODE` (`agent` default, or `snippets`) picks the research path; `RESEARCH_MAX_SNIPPETS` (default 10) and `RESEARCH_SNIPPET_CHARS` (default 600) bound snippet mode. With `snippets`, set `RESEARCH_REASONING_EFFORT` to the research model's lowest effort (`none` on Luna). Invalid values fail worker boot. Run `bun run eval:research` before switching.
- **Tier cache (both services, optional):** `FEATURE_TIER_CACHE_TTL_MS` (default `60000`; `0` disables) is how long each process caches tier documents. After re-seeding tiers, allow this long for the change to apply.
- **OpenRouter retries (worker, optional):** `OPENROUTER_TIMEOUT_MS` (per-try timeout, default 240000), `OPENROUTER_MAX_ATTEMPTS` (default 3; `1` turns retrying off), `OPENROUTER_RETRY_BASE_MS` (default 1000), `OPENROUTER_RETRY_MAX_DELAY_MS` (default 15000) and `OPENROUTER_RETRY_BUDGET_MS` (most time one call may sleep between tries, default 45000). The worker makes the LLM calls; the API reads them too at boot, so an invalid value fails either service.
- **Worker drain window:** set `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=130` on the worker service. It is the time Railway waits between `SIGTERM` and `SIGKILL` on a redeploy; its default is a few seconds, which kills running jobs almost at once. On `SIGTERM` the worker stops taking jobs, lets running ones finish, and exits 0; after `WORKER_SHUTDOWN_TIMEOUT_MS` (default 120000) it exits 1 instead, and the unfinished job resumes on the new worker from its checkpoint. Keep the drain window at least `WORKER_SHUTDOWN_TIMEOUT_MS` / 1000 + 10 seconds. The start command must be `node ...` directly, not `bun run` or `npm start`, because a package-manager wrapper can swallow `SIGTERM`.
- **Artifact-run queues (worker, optional):** POST and POLL runs go on the `workflow` queue, DOCUMENT runs on `workflow-document`, each with its own worker. `WORKFLOW_TEXT_CONCURRENCY` and `WORKFLOW_DOCUMENT_CONCURRENCY` (default 1 each; set production to 10 and 2) are how many jobs each runs at once, and `WORKFLOW_LOCK_DURATION_MS` (default 30000) is the job lock on both. Invalid values fail boot.
- **Per-user run cap (both services, optional):** `MAX_INFLIGHT_RUNS_PER_USER` (default 0 = off) caps how many artifact runs one user has in flight; over it a launch gets `429 run.too_many_in_flight`. `RUN_INFLIGHT_LEASE_SECONDS` (default 1800) is how long an unreleased slot lasts before it frees itself. Set the cap on both services; the API reserves and the worker refreshes and releases.
- **Browserless slots (worker, optional):** set `BROWSERLESS_MAX_CONCURRENT_SESSIONS` to the Browserless plan's concurrent sessions (`2` on Free) so renders wait for a free session instead of failing; unset or `0` turns the wait off. `BROWSERLESS_SLOT_WAIT_MAX_MS` (default 120000) is the longest a render waits. Invalid values fail boot.
- **Mongo pool:** set `MONGO_MAX_POOL_SIZE` (default 10) and `MONGO_MIN_POOL_SIZE` (default 2) per service; invalid values fail boot. The worker's max pool must be at least its total worker concurrency + 10.
- **Watch paths** (both services): `apps/api/**`, `bun.lock`, `package.json`, `bunfig.toml`
- **If you don't use Docker, two things are required:**
  1. `nest build` must run under **Node**, not Bun. Under Bun, `src/...` imports are left unresolved in `dist/`, and the app crashes with `Cannot find module 'src/common/HelperFn'`.
  2. The start command must run from `apps/api` (for example `cd apps/api && node dist/main.js`), because templates load from `process.cwd()/assets`.

**Deploy order when the queues change.** Deploy the worker before the API. The worker that splits the `workflow` and `workflow-document` queues consumes both, and also finishes DOCUMENT jobs already waiting on `workflow`; an API deployed first would enqueue DOCUMENT runs on `workflow-document` with no worker to take them until the worker rolls.

**Deploy order on a `contract` bump.** When a release raises the Design System `SUPPORTED_CONTRACT`, deploy the worker before the API (document generation spec §11.7). Once the API is on the new contract, it pins new Attempts to it, and a worker still on the old one fails them as transient `contract ≠ SUPPORTED_CONTRACT` errors until it rolls.

## Docker

- `apps/api/Dockerfile` is a multi-stage build from the repository root. It installs only `@marquill/api` dependencies with `--frozen-lockfile`, builds under Node, and ships a `node:22-slim` runtime with production dependencies, `dist/`, and `assets/`.
- The root `docker-compose.yml` provides local infrastructure: `docker compose up -d` starts MongoDB, Redis, the BullMQ dashboard, MinIO (S3 API :9000, console :9001, `minioadmin`/`minioadmin`, bucket `marquill-local` created by `minio-init`), and Browserless (:3002). `--profile app` also runs the api and worker from the image, pointed at `http://minio:9000` and `http://browserless:3000`.
- MinIO uses the community image `coollabsio/minio`, because MinIO stopped publishing official images. Under `--profile app`, presigned URLs are unreachable from the browser; see `apps/api/AGENTS.md`.
- The compose project name stays `linkgenserver`, so existing local volumes (`linkgenserver_mongo_data`, `linkgenserver_redis_data`) keep their data.
- The web and landing apps are not containerised, because they deploy to Vercel.

## Known follow-ups

- Clear the lint backlog in `apps/api` (about 780 errors) and `apps/web` (36 errors), then add `lint` to `bun run check`.
- Fix the stale type literals in api spec files (`tsc --noEmit` on the full `tsconfig.json` reports them; ts-jest tolerates them).
- The shared API contract is still documentation (`apps/api/docs/api/`). A `packages/contracts` workspace with shared Zod schemas would turn contract drift between web and api into a type error.
