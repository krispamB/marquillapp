# API + worker image. Build from the repository root so the workspace lockfile
# is in the context:
#
#   docker build -f apps/api/Dockerfile -t marquill-api .
#
# The same image runs both processes:
#   HTTP server: node dist/main.js                            (default CMD)
#   Worker:      node dist/workflow/workers/workflow.worker.js

# Build on Node with the Bun binary added. `nest build` must run under Node: under
# Bun, require.resolve honours tsconfig's baseUrl, so Nest's path-rewrite hook
# mistakes `src/...` imports for packages and leaves them unresolvable in dist/.
FROM oven/bun:1.3.5 AS bun

FROM node:22-slim AS manifests
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /repo
COPY package.json bun.lock bunfig.toml ./
# Every workspace manifest must be present for --frozen-lockfile to validate.
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/landing/package.json apps/landing/

FROM manifests AS build
RUN bun install --frozen-lockfile --filter @marquill/api
COPY apps/api apps/api
RUN cd apps/api && bun run build

FROM manifests AS prod-deps
RUN bun install --frozen-lockfile --production --filter @marquill/api

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=prod-deps /repo ./
COPY --from=build /repo/apps/api/dist apps/api/dist
# Mail templates and Design Systems are read from process.cwd()/assets at runtime.
COPY apps/api/assets apps/api/assets
WORKDIR /repo/apps/api
EXPOSE 3500
CMD ["node", "dist/main.js"]
