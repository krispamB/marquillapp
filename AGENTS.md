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
Auth is Google OAuth via a separate backend. On callback, the backend sets two cookies: `access_token` and `user` (a JSON-encoded user object). `middleware.ts` guards `/dashboard`, `/posts`, and `/onboarding`. After sign-in, `app/auth/callback/AuthRedirect.tsx` routes first-time users to `/onboarding` and returning users to `/dashboard` (detected via `localStorage.getItem('marquill_onboarding_complete')`).

### API Pattern
No centralized API client. Every client component uses native `fetch()` with `credentials: "include"`. Base URL from `process.env.NEXT_PUBLIC_API_BASE_URL`. The consistent pattern:

```ts
const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/endpoint`, {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
if (!res.ok) throw new Error(await res.text());
const data = await res.json();
```

### Server vs Client Components
- **`page.tsx` (server):** reads cookies, fetches initial data, passes as props
- **`*Client.tsx` (client):** owns interactivity, state, and all API calls
- No server actions — all mutations are client-side fetch

### Onboarding Flow (`app/onboarding/`)
6-step post-signup flow. State is owned by `OnboardingClient.tsx`; step UIs live in `steps.tsx`; shared primitives (Progress, RadioTile, GoalTile, Chip) in `components.tsx`; styles in `onboarding.css`. The flow branches on `persona` ("creator" | "writer") — step 2 and goals differ per persona. Server enums for API payloads live in `types.ts`.

## Environment Variables
- `NEXT_PUBLIC_API_BASE_URL` — backend root (defaults to `http://localhost:3500/api/v1`)
- `NEXT_PUBLIC_UNSPLASH_ACCESS_KEY`, `NEXT_PUBLIC_PEXELS_ACCESS_KEY` — stock images in post creation
