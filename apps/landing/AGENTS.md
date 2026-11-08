# AGENTS.md — apps/landing

The marketing site at marquill.com (`@marquill/landing`). Read the root [AGENTS.md](../../AGENTS.md) first; it has the repo map, the cross-app contracts, and the working rules. This file covers only the landing site.

## Commands

Run these from `apps/landing`, or from the root with `bun run --filter @marquill/landing <script>`:

```bash
bun run dev        # dev server at localhost:3001
bun run build      # static export to out/
bun run typecheck  # tsc --noEmit
bun run lint       # ESLint flat config (a few existing errors; lint only the files you touched)
```

There are no tests. Before committing, run `bun run typecheck` and `bun run build`: the build is the check that every route still exports statically.

## Architecture

**Stack:** Next.js 16 App Router, TypeScript, Tailwind CSS v4, `output: 'export'`.

- **Static export only.** Nothing may need a server at request time: no route handlers, no server actions, no `cookies()` or `headers()`, no dynamic routes without `generateStaticParams`. Images are unoptimized (`images.unoptimized: true`).
- **Homepage (`app/page.tsx`)** is assembled from section components in `components/landing/`.
- **Status board and changelog** (`liveNow`, `shippingNext`, `changelog` in `data.tsx`) are derived from the product ledger in `packages/product`. Edit features there; see "Product ledger" in the root AGENTS.md.
- **`components/landing/data.tsx`** is the single source for plans, FAQs, and feature steps. Both the homepage pricing section and `app/pricing/page.tsx` read from it, so don't duplicate that content in a page. Plan limits must match the api's tier seeds (`apps/api/src/scripts/tier-seeds.ts`).
- **Blog:** posts are markdown strings in `lib/posts.ts`, rendered by `app/blog/[slug]/page.tsx` with `react-markdown` and `remark-gfm`.
- **Links into the product** go through `normalizeAppUrl(process.env.NEXT_PUBLIC_APP_URL)` from `config/urls.ts`. Never hardcode the app URL.
- **Checkout** (`app/checkout/`) opens Paddle.js on the client.
- **Theme:** `config/theme.ts` and `components/ThemeScript.tsx` handle light and dark mode. Section anchors (`#status`, `#what-mark-makes`, `#design-systems`, `#one-workspace`, `#changelog`, `#pricing`, `#feedback`) are linked from `Header.tsx` and `Footer.tsx`; keep them in sync when you rename a section.

## Copy

- The brand palette and typography are in [`docs/brand_guide.md`](../../docs/brand_guide.md) at the repository root; the tokens themselves live in `app/globals.css`.
- Describe what Mark actually does: he researches the topic, drafts in the user's voice, and publishes on schedule. Don't claim features, trials, or discounts the product doesn't have.
- `docs/specs/` holds the original landing page requirements and design specs. They are historical; the current copy supersedes them.

## Environment variables (`.env.local`)

- `NEXT_PUBLIC_APP_URL` — the product app origin used by every CTA
- `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`, `NEXT_PUBLIC_PADDLE_ENVIRONMENT` — Paddle.js on `/checkout`
- `NODE_ENVIRONMENT` — `production` enables production-only behaviour in `app/layout.tsx`; `development` shows the theme toggle

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
