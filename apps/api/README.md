# @marquill/api

The Marquill backend: a NestJS 11 HTTP API plus a BullMQ worker that generates, renders, schedules, and publishes LinkedIn artifacts. It deploys to Railway.

```bash
docker compose up -d   # from the repo root: MongoDB, Redis, BullMQ dashboard
cp .env.example .env   # then fill in the keys listed in AGENTS.md
bun run dev            # http://localhost:3500/api/v1
```

Architecture, conventions, testing rules, and production notes are in [AGENTS.md](AGENTS.md). Design documents are in [docs/](docs/), and the client-facing API reference is in [docs/api/](docs/api/README.md).
