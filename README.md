# Marquill

Marquill is an AI LinkedIn workspace. Mark researches a topic, drafts posts, carousels, and polls in the user's voice, and publishes them on schedule.

| App | Path | Stack | Deploys to |
| --- | --- | --- | --- |
| Product app | [`apps/web`](apps/web) | Next.js 16, Clerk, Tailwind v4 | Vercel |
| API and worker | [`apps/api`](apps/api) | NestJS 11, MongoDB, Redis/BullMQ | Railway |
| Marketing site | [`apps/landing`](apps/landing) | Next.js 16 static export | Vercel |

## Setup

Requires [Bun](https://bun.sh) 1.3+ and Docker.

```bash
bun install
docker compose up -d        # MongoDB, Redis, BullMQ dashboard (localhost:8080)

# env files, one per app (never at the root)
cp apps/api/.env.example apps/api/.env   # then fill in
# apps/web/.env and apps/landing/.env.local: keys are listed in each app's AGENTS.md

bun run dev                 # web :3000, landing :3001, api :3500
```

## Everyday commands

```bash
bun run check               # typecheck + tests across all apps
bun run check:affected      # the same, only for apps changed relative to main
bun run build               # production builds
bun run --filter @marquill/api test   # any script, for one app
```

## Docs

- [AGENTS.md](AGENTS.md): how the apps fit together and the rules for working in this repo. Each app has its own `AGENTS.md`.
- [docs/monorepo.md](docs/monorepo.md): the repository layout, deploy settings, Docker, and how this repo was assembled from three.
- [apps/api/docs/api/](apps/api/docs/api/README.md): the client-facing API reference.
