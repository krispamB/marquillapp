# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

## Implementation Workflow

Prioritize completing the requested functionality first.

Do not perform code review, refactoring, optimization, or quality-improvement workflows until the requested feature is fully implemented and the user has explicitly verified that it works. Do not invoke review-oriented skills or agents prematurely, because they interrupt the implementation workflow and consume unnecessary context.

After the user confirms that the implementation behaves as expected, you may proceed with code review, cleanup, refactoring, performance improvements, documentation updates, or other polish.

## Commands

```bash
bun run dev      # dev server at localhost:3000
bun run build    # production build
bun run lint     # ESLint
```

Run `bun run build` before `git add` to catch type and compile errors.

No test suite is configured.

## Architecture

**Stack:** Next.js 16 App Router, TypeScript, Tailwind CSS v4.

### Auth & Routing
Authentication is managed by Clerk. `app/layout.tsx` installs `ClerkProvider`, and `proxy.ts` protects `/dashboard`, `/posts`, `/billing`, `/calendar`, `/settings`, and `/onboarding`. Server components use `auth()` from `@clerk/nextjs/server`; unauthenticated users are redirected to `/sign-in`. Workspace routes read the backend onboarding profile and redirect incomplete users to `/onboarding`; completed users who visit onboarding are redirected to `/dashboard`.

### API Pattern
Authenticated browser-to-backend requests must use `apiFetch` from `app/lib/api.ts`. It asks the active Clerk session for a fresh token, sends it as a Bearer token, and keeps `credentials: "include"` for backend compatibility. Use plain `fetch()` only for external resources such as stock images, presigned uploads, and raw image downloads.

```ts
import { apiFetch } from "../lib/api";

const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/endpoint`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
if (!res.ok) throw new Error(await res.text());
const data = await res.json();
```

Clients under `app/redesign/` may use `readApi` and `jsonRequest` from `app/redesign/api.ts`. These wrap `apiFetch` with JSON parsing, consistent error handling, and feature-limit error normalization:

```ts
const data = await readApi<ResponseType>(
  `${API_BASE}/endpoint`,
  jsonRequest(payload, { method: "POST" }),
);
```

Server components use the helpers in `app/lib/session.ts` to mint fresh Clerk credentials and forward both the `Authorization` and `Cookie` headers to the backend. The public client base URL comes from `NEXT_PUBLIC_API_BASE_URL`; server-side backend calls use `BACKEND_API_URL`.

### Server vs Client Components
- **`page.tsx` (server):** authenticates with Clerk, fetches initial data, and passes it as props
- **`*Client.tsx` (client):** owns interactivity, state, and backend mutations through `apiFetch` or the redesign API helpers
- No server actions — mutations are client-side requests

### Onboarding Flow (`app/onboarding/`)
6-step post-signup flow. State is owned by `OnboardingClient.tsx`; step UIs live in `steps.tsx`; shared primitives (Progress, RadioTile, GoalTile, Chip) in `components.tsx`; styles in `onboarding.css`. The flow branches on `persona` ("creator" | "writer") — step 2 and goals differ per persona. Server enums for API payloads live in `types.ts`.

## Environment Variables
- `NEXT_PUBLIC_API_BASE_URL` — backend root (defaults to `http://localhost:3500/api/v1`)
- `BACKEND_API_URL` — absolute backend root for server-side requests (defaults to `http://localhost:3500/api/v1`)
- `NEXT_PUBLIC_UNSPLASH_ACCESS_KEY`, `NEXT_PUBLIC_PEXELS_ACCESS_KEY` — stock images in post creation
