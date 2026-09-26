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

- **Bun workspaces** (`apps/*`) with one root `bun.lock`. `bunfig.toml` pins `linker = "hoisted"`: the isolated linker makes mongoose's transitive `mongodb` types unnameable in the api's declaration emit (TS2742), which breaks `nest build`.
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
- **Watch paths** (both services): `apps/api/**`, `bun.lock`, `package.json`, `bunfig.toml`
- **If you don't use Docker, two things are required:**
  1. `nest build` must run under **Node**, not Bun. Under Bun, `src/...` imports are left unresolved in `dist/`, and the app crashes with `Cannot find module 'src/common/HelperFn'`.
  2. The start command must run from `apps/api` (for example `cd apps/api && node dist/main.js`), because templates load from `process.cwd()/assets`.

## Docker

- `apps/api/Dockerfile` is a multi-stage build from the repository root. It installs only `@marquill/api` dependencies with `--frozen-lockfile`, builds under Node, and ships a `node:22-slim` runtime with production dependencies, `dist/`, and `assets/`.
- The root `docker-compose.yml` provides local infrastructure: `docker compose up -d` starts MongoDB, Redis, and the BullMQ dashboard. `--profile app` also runs the api and worker from the image.
- The compose project name stays `linkgenserver`, so existing local volumes (`linkgenserver_mongo_data`, `linkgenserver_redis_data`) keep their data.
- The web and landing apps are not containerised, because they deploy to Vercel.

## Known follow-ups

- Clear the lint backlog in `apps/api` (about 780 errors) and `apps/web` (36 errors), then add `lint` to `bun run check`.
- Fix the stale type literals in api spec files (`tsc --noEmit` on the full `tsconfig.json` reports them; ts-jest tolerates them).
- The shared API contract is still documentation (`apps/api/docs/api/`). A `packages/contracts` workspace with shared Zod schemas would turn contract drift between web and api into a type error.
