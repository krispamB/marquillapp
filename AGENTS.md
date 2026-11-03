# AGENTS.md

Guidance for coding agents working anywhere in this repository. This file covers what applies across the whole repo. Each app has its own `AGENTS.md` with its architecture, conventions, and environment variables; read the one for the app you are changing before you change it.

## Repository map

| Path | Package | What it is | Deploys to |
| --- | --- | --- | --- |
| `apps/web` | `@marquill/web` | Next.js 16 product app: Clerk auth, dashboard, composer, billing | Vercel |
| `apps/api` | `@marquill/api` | NestJS 11 API and BullMQ worker (two processes, one codebase) | Railway |
| `apps/landing` | `@marquill/landing` | Next.js 16 marketing site, static export | Vercel |
| `packages/product` | `@marquill/product` | Product ledger: every feature, its status, and the changelog | read by landing |

Bun workspaces and Turborepo. There is one `bun.lock` at the root. `bunfig.toml` pins the hoisted linker, because isolated installs break the api's declaration emit. Never add a per-app lockfile, and never use npm, yarn, or pnpm.

## How the apps connect

- **web → api.** The browser calls `/api/v1/*` on the web origin, and `apps/web/next.config.ts` rewrites those calls to `BACKEND_API_URL`. Auth is Clerk: web sends the Clerk session token, and the api's `ClerkAuthGuard` verifies it.
- **API contract.** `apps/api/docs/api/` is the single source of truth for the client-facing API. When you change an endpoint, update that doc and the web caller in the same change.
- **landing → web.** Every CTA links to `NEXT_PUBLIC_APP_URL`. The plan names and limits in `apps/landing/components/landing/data.tsx` must match the tiers seeded in `apps/api/src/scripts/tier-seeds.ts`.
- **landing ← product ledger.** The landing status board and changelog are generated from `packages/product`. Never edit them in `apps/landing`; edit the ledger.
- **Domain vocabulary.** `apps/api/CONTEXT.md` is the glossary (Artifact, Document Version, Candidate Source, ...). Use its terms in code, docs, and issues, and respect its _Avoid_ lists.

## Commands

Run from the repository root:

```bash
bun install                         # all workspaces
docker compose up -d                # MongoDB, Redis, BullMQ dashboard, MinIO, Browserless (the api needs these)
bun run dev                         # api :3500 first, then web :3000 and landing :3001 once the api answers
bun run --filter @marquill/web dev  # a single app

bun run check                       # typecheck + tests, every app
bun run check:affected              # the same, only for apps changed relative to main
bun run build                       # production builds
bun run lint                        # ESLint, every app (see the lint backlog below)
```

Inside an app directory, `bun run <script>` runs that app's own scripts.

**Before committing**, run `bun run check`. If you touched build config, routing, or `next.config.ts`, also run `bun run build` for that app.

**Lint backlog.** `apps/api` and `apps/web` have existing lint errors, so `bun run lint` fails today. Don't add new ones: from the app directory, lint only the files you touched (`bunx eslint <files>`). Don't run `lint:fix` or `format` across a whole app as part of a feature change, because it creates unrelated churn.

## Working rules

- **Implementation first.** Complete the requested functionality first. Don't start review, refactoring, optimization, or cleanup, and don't invoke review-oriented skills or agents, until the user has confirmed the feature works.
- **Subagents.** The default limit is zero. Create subagents only when the user's prompt or an applicable skill explicitly asks for them. Even then, use no more than requested, or the minimum needed.
- **Docs.** Design and decision documents live in each app's `docs/` folder; cross-app documents live in the root `docs/`. Before changing an area, search the relevant `docs/` folder by filename and read only the documents that apply. Write new documentation in the matching `docs/` folder.
- **Scope.** Keep a change inside one app unless it changes a contract between apps. A contract change updates both sides in the same commit.
- **Issues.** All issues live in `krispamB/marquillapp`. Label each one with `app:web`, `app:api`, or `app:landing`. Older commit messages and docs may reference `krispamB/linkgenserver#N` or `krispamB/incontentailanding#N`. Those are the original repositories; their issue links redirect here, and their pull requests remain there.

## Product ledger

`packages/product/src/features.ts` lists every feature Marquill has, is building, or has discussed; `packages/product/src/changelog.ts` lists what shipped. `packages/product/FEATURES.md` is the readable version, generated from them. Read `FEATURES.md` before proposing or building a feature, so you know what already exists.

Keep it current as part of the work, without being asked:

- **A change users can see updates the ledger in the same PR.** Add or edit the feature entry; refactors, infra, and internal tooling don't count. When a change will make a feature live, draft its changelog entry now; the landing page only shows it once the feature is `live`.
- **`live` means deployed to production and switched on.** Merged but not deployed, or behind a flag or a pending cutover, is `building`. You usually can't see production, so ask the user before setting `live`, and when they confirm, set `since` and the changelog entry's `date` to the go-live day.
- **Record ideas when a discussion settles on one.** When you and the user agree a feature is worth doing someday, or the user asks for one, add it as `status: 'idea'` with `discussed: { date, summary }` in the same session. Don't add ideas you raised that the user didn't take up. Update an existing entry rather than adding a near-duplicate.
- **Planned and building need an issue or a design doc.** Link them in `issues` or `docs`.
- **Only the user puts a feature on the landing board** (`board: true`). Shipping next is a public promise. Public copy follows the copy rules in `apps/landing/AGENTS.md`.
- **Never rename an `id`.** Changelog entries point at it.
- **When the ledger and the code disagree, the code wins.** Fix the entry, and add a `notes` line if the landing page or plan copy claimed something the code doesn't do.
- **Close the loop.** When a feature goes live, say which of its linked issues can be closed.

After editing, run `bun run --filter @marquill/product render` to regenerate `FEATURES.md`. The ledger's tests in `bun run check` fail on a stale `FEATURES.md`, missing go-live dates, unknown plan names, broken doc links, and an unsorted changelog.

## Environment files

Each app reads its env file from its own directory. None live at the root.

| App | File | Template |
| --- | --- | --- |
| web | `apps/web/.env` | keys listed in `apps/web/AGENTS.md` |
| api | `apps/api/.env` | `apps/api/.env.example` |
| landing | `apps/landing/.env.local` | keys listed in `apps/landing/AGENTS.md` |

## Worktrees

Put worktrees under `.codex/worktrees/<branch>`; that path is gitignored, and so is `.claude/worktrees/`.

```bash
git worktree add .codex/worktrees/<branch> -b <branch>
cp apps/web/.env         .codex/worktrees/<branch>/apps/web/
cp apps/api/.env         .codex/worktrees/<branch>/apps/api/
cp apps/landing/.env.local .codex/worktrees/<branch>/apps/landing/
cd .codex/worktrees/<branch> && bun install
```

Copy the env files before doing any work in a worktree, because the apps fail to start without them. Remove the worktree with `git worktree remove .codex/worktrees/<branch>` when you're done.

## Deployment

See [docs/monorepo.md](docs/monorepo.md) for the Vercel and Railway settings and the Docker image. `apps/api/Dockerfile` builds the API and worker image from the repository root.
