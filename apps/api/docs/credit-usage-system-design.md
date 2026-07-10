# Credit-Based Usage System — Design

> Status: design spec for wayfinder map #99, ticket #105 (grilling outcome).
> Author: generated for Christopher Pam. Decisions settled 2026-07-09.
> Implements the `CreditMeter` interface #103 defines and consumes the raw usage
> signals #104 emits. Generalizes the existing `mark_tokens` per-period budget into
> a cost-backed **credit** meter that gates *all* artifact generation.

Feeds the final spec assembly (#110). This ticket owns **credit denomination, the
token/cost→credit exchange, surcharge amounts, the `Tier`/`Usage` schema changes, the
enforcement points, and the Paddle/tier-config implications**. The engine's hook timing
(#103 §9) and the agent's raw signals (#104 §7) are givens.

## Framing (charter-derived givens)

- **Charter #8:** usage gating moves to token-backed **credits** per tier per period;
  non-LLM actions (web search, Browserless render) carry **fixed credit surcharges**.
- **Charter #9 / #104:** `src/mark` is dissolved. The existing `mark_tokens` budget
  (`FeatureGatingService.assertMarkTokenQuota` / `incrementMarkTokenUsage`, the `MarkRun`
  doc) is the **prior art and the seed** — credits are its generalization, not a
  greenfield build.
- **Clean write-over (#100):** relaunch, no users. No migration/backfill of usage rows,
  no coexistence window — `mark_tokens` is renamed/reshaped in place and `ai_drafts`
  retired outright.
- **#103 §9 owns hook *timing*; #105 owns *conversion + amounts*.** #105 does **not**
  move where the meter fires; it defines what a recorded signal is worth in credits, the
  balance guard, and the debit.
- **#104 §7 emits raw signals, not credits:** each LLM turn → `record({ kind: 'llm',
  amount: usage.cost, detail: { model, totalTokens } })` where `usage.cost` is the
  **real per-call USD cost** from OpenRouter's `costDetails`; each web search →
  `record({ kind: 'web_search', amount: 1 })`. Converting those to credits is this
  ticket's job.

---

## 1. Credit denomination — a cost-backed unit

**A credit is a fixed slice of underlying model spend.** Define the peg once, in config:

```
1 credit = $0.001 of raw provider cost      →  CREDITS_PER_USD = 1000
```

`CREDITS_PER_USD` and a margin multiplier `CREDIT_MARKUP` (default `1.0`) are global env
(`ConfigService`, code defaults, added to `.env.example`) — never per-tier. Per-tier
config carries **only the allowance** (§5).

LLM cost → credits (in `record`, kind `'llm'`):

```
credits = ceil(amount_usd * CREDITS_PER_USD * CREDIT_MARKUP)
```

Because the amount is OpenRouter's authoritative per-call `usage.cost` — which already
prices each model's input and output tokens at that model's real rate — the credit price
of a call is **automatically correct per model and self-updating** when OpenRouter changes
prices. This directly retires the price-blindness caveat banked from the Mark design (a
raw token budget "changes operator margin, not the user's allowance" when the model
swaps); a cost-backed credit does not drift.

**Rejected — raw token count as the unit (the current `mark_tokens` model).** A token is
price-blind: 1000 tokens of a frontier model and 1000 of a cheap one cost the operator
wildly different amounts, yet debit the same budget. It also needs a hand-maintained
per-model token→credit table that drifts every time provider prices move. `usage.cost`
already encodes all of that.

**Rejected — store raw USD and skip credits entirely.** Fractional dollars ($0.031) are
an awkward, leaky unit to show users and to sell in Paddle plans; a whole-number credit
is a clean allowance ("2,000 credits/mo") and hides the operator's true cost/margin.

**Rejected — a fixed markup baked so deep users can't be repriced.** Margin lives in two
tunable levers — `CREDIT_MARKUP` (pad conversion) and the Paddle **price** of a credit
allowance — so pricing can move without a code change.

## 2. The token→credit exchange the issue names

The issue asks for "LLM-token→credit exchange rates." In this design the exchange is
**realized through cost, not a literal token table** — §1's `usage.cost` *is* the
per-model token exchange, applied continuously. Tokens are still carried on
`detail.totalTokens` for **display, audit, and the fallback path**, not for pricing.

**Fallback token rate (only when cost is missing).** If a provider/model returns
`usage.cost` as `0`/`undefined`, fall back to a token estimate so a run is never
under-charged to zero:

```
credits = ceil(totalTokens / 1000 * FALLBACK_CREDITS_PER_1K_TOKENS)   // FALLBACK_… is env
```

This is a coarse safety net (one flat rate, not per-model). For OpenRouter v1 (#104 §9),
`cost` is always present, so the fallback should effectively never fire; it exists so a
future provider without cost reporting can't slip through free. Log a warning when it does.

## 3. Fixed surcharges for non-LLM actions

Web search (Tavily) and PDF render (Browserless) cost the operator real money but emit no
`usage.cost`. Each carries a **flat credit surcharge**, priced in the same credit unit so
it is commensurable with LLM credits (i.e. set each ≈ the action's real cost × peg × markup):

| Signal `kind`  | Fired by (#104/#103)                    | Env constant                    | Illustrative |
|----------------|------------------------------------------|----------------------------------|--------------|
| `web_search`   | research agent, per Tavily call (#104 §7) | `CREDIT_SURCHARGE_WEB_SEARCH`   | `8`          |
| `pdf_render`   | RENDER_PDF step, per Browserless render (#103 §4) | `CREDIT_SURCHARGE_PDF_RENDER` | `5` |

Surcharge signals carry `amount` as a **count**, not dollars:

```
credits = amount * CREDIT_SURCHARGE_<KIND>
```

`UsageKind` is defined here (the enum #103 §9 references):

```ts
type UsageKind = 'llm' | 'web_search' | 'pdf_render';
```

So **`record`'s `amount` is polymorphic by `kind`** — USD for `llm`, a unit count for
surcharges. This asymmetry is inherited from #103/#104's committed `record({ kind, amount })`
shape; #105 pins the interpretation in one conversion table (§4) rather than reshaping the
upstream signal.

**Rejected — a separate `record` overload per kind (dollars vs count).** Splits the one
narrow hook #103 deliberately kept, for no gain; a `switch (kind)` in the converter is
enough.

**Rejected — surcharge as a % of the run's LLM credits.** A web search's cost is fixed and
independent of how expensive the generation model is; a flat credit charge models reality.

## 4. `CreditMeterService` — realizing #103's `CreditMeter`

#103 §9/§10 hands each run a `ctx.meter: CreditMeter`:

```ts
interface CreditMeter {
  assertBalance(userId: string): Promise<void>;                        // pre-run guard
  record(usage: { kind: UsageKind; amount: number; detail?: unknown }): void; // during
  commit(runId: string): Promise<void>;                                // post-run debit
}
```

**Split of ownership.** #103 owns the *stateful, per-run* half (the attempt-scoped
`creditsUsed` accumulator on `WorkflowRun`, per-attempt reset, `usage.tick` emission).
#105 owns the *stateless* half — a singleton injectable `CreditMeterService` the engine
composes into `ctx.meter`:

```ts
@Injectable()
class CreditMeterService {
  toCredits(usage: { kind: UsageKind; amount: number }): number; // §1–§3 conversion — pure
  assertBalance(userId: string): Promise<void>;                  // §6 pre-run guard
  debit(userId: string, credits: number): Promise<void>;         // §6 period-aggregate write
}
```

- `record` (engine-side) calls `toCredits(...)`, adds the result to the attempt-scoped
  `creditsUsed`, and emits `usage.tick` carrying the credit delta + running total (the
  detail #107's SSE renders live).
- `commit(runId)` (engine-side) reads the winning attempt's `creditsUsed` and calls
  `debit(userId, creditsUsed)` — the **only** real write to the period aggregate.
- `assertBalance` delegates straight to `CreditMeterService`.

`toCredits` is pure and synchronous (config in, integer out) — trivially unit-testable per
the repo's manual-construction style, and it keeps `record` non-async (#103 requires
`record` to return `void`).

**Rejected — put the attempt-scoped accumulator in `CreditMeterService`.** It is per-run
state that belongs on the `WorkflowRun` the engine already owns and resets per attempt
(#103 §9); duplicating it here invites double-count and a second source of truth.

**Rejected — fold everything into `FeatureGatingService`.** The meter needs the run
record and the engine's emit; `FeatureGatingService` owns tier/period/`Usage` primitives
only. `CreditMeterService` depends **on** `FeatureGatingService` for those (see §5/§6) and
adds conversion — a clean layering, mirroring how `MarkUsageService` sat above the gating
service today.

## 5. Schema & config changes

**`FeatureKey` — rename, don't add.** `mark_tokens` → `credits` (it is already a variable
per-period consumption meter; we are re-denominating and re-scoping it, not inventing a
sibling). `ai_drafts` is **removed** (§7). Final set:

```ts
export const FEATURE_KEYS = {
  CREDITS: 'credits',                    // was mark_tokens — the consumption meter
  CONNECTED_ACCOUNTS: 'connected_accounts', // capacity counter — unchanged
  SCHEDULED_POSTS: 'scheduled_posts',       // capacity counter — unchanged
} as const;
```

**`Tier.limits`** — the `Feature` union drops `ai_drafts`/`mark_tokens`, gains `credits`:

```ts
type Feature = 'credits' | 'connected_accounts' | 'scheduled_posts';
```

`limits.credits` is the per-period allowance: a positive integer, `-1` = unlimited
(short-circuits the guard, as the current `assertScheduledPostQuota`/`assertMarkTokenQuota`
already do), `0` = **AI disabled on this plan** (every run blocked — the free/no-AI tier).

**`Usage`** — schema unchanged. Consumption is recorded exactly as today, keyed
`(user_id, 'credits', periodStart)`, with the same unique index and the same `$inc` upsert
+ E11000-retry write path (`incrementMarkTokenUsage` becomes `incrementCreditUsage`, unit
now credits). **Period resolution is reused verbatim** — subscription
`currentPeriodStart` or UTC-month start (`resolveUsagePeriod`). Credits reset each period;
**no rollover** in v1.

**No new `MarkRun`-style ledger collection.** The per-run credit breakdown already lives on
the `WorkflowRun` (#103's `creditsUsed` + the recorded ticks); the period total lives on
`Usage`. That covers dashboard, SSE, and audit without a third store. The `MarkRun`
collection is deleted with the rest of `src/mark`.

**Config (new global env, `.env.example`):** `CREDITS_PER_USD`, `CREDIT_MARKUP`,
`FALLBACK_CREDITS_PER_1K_TOKENS`, `CREDIT_SURCHARGE_WEB_SEARCH`,
`CREDIT_SURCHARGE_PDF_RENDER`. Retire all `MARK_*`.

## 6. Enforcement points

Three touch points, matching #103 §9's commit-on-success timing:

1. **HTTP pre-check (fast 4xx).** `POST /artifacts` calls `assertBalance(userId)` before
   enqueueing the run, so an out-of-credits user gets an immediate
   `FeatureGateForbiddenException` (code `FEATURE_LIMIT_EXCEEDED`, feature `credits`,
   `limit`/`currentUsage`, `upgradeHint`) instead of a queued run that fails. This is the
   same exception shape the frontend already handles.
2. **Worker pre-run guard (defensive).** The engine calls `ctx.meter.assertBalance(userId)`
   before the step loop (#103 §9). Insufficient → **terminal** `WorkflowError` → run/version
   `FAILED`, reason `"insufficient credits"`. Guards the race where balance drained between
   enqueue and pickup.
3. **Post-run debit (commit-on-success).** On `run.completed`, `commit(runId)` debits the
   winning attempt's `creditsUsed`. Failed/retried attempts debit **nothing** — the operator
   absorbs transient-failure spend (#103 §8). Settlement is **best-effort** (try/catch + log;
   never fail a user's *completed* run over an accounting write, carried over from the Mark
   settlement rule).

**Balance semantics — headroom check, not fit check.** `assertBalance` passes iff
`used < limit` (or `limit === -1`). It does **not** verify the whole run will fit, because
commit-on-success has no pre-run estimate to fit against (#103 rejected pre-authorization —
no estimator, no hold). A user with 5 credits left may start a run that settles at 60 and
overshoot the period; the **next** run's guard blocks (`used ≥ limit`). Bounded overshoot
is accepted and intentional — the agent's max-iteration cap (#104 §2) caps a single run's
worst case, and this mirrors the current Mark gate ("the allowed run may overshoot; next
run's gate catches it").

**No mid-run cutoff in v1.** #103's hooks accumulate live `creditsUsed`, so a cutoff
(abort when `used + creditsUsed ≥ limit` mid-loop) is a *later* addition needing no new
plumbing — explicitly left as room, not built.

**Refine runs.** Refine reuses cached research (#104 §6/#103 §11) → **no `web_search`
surcharge**, only the generation LLM call (+ a `pdf_render` surcharge for DOCUMENT). Refine
is metered and gated identically; it is just cheaper.

## 7. Coexistence with the existing counters

The four current features split cleanly into **one consumption meter** and **two capacity
counters**:

| Current feature       | Fate                          | Why |
|-----------------------|-------------------------------|-----|
| `mark_tokens`         | → **`credits`** (renamed, re-denominated) | already the per-period consumption meter |
| `ai_drafts`           | **retired**                   | "N drafts/month" is replaced by credit consumption — every generation run debits credits, so a separate draft counter is redundant double-gating |
| `scheduled_posts`     | **unchanged counter**         | scheduling is a plan *capacity* limit, not compute; no LLM/tool cost to meter |
| `connected_accounts`  | **unchanged counter**         | account capacity, not consumption; still a discrete `countDocuments` gate |

So generation moves entirely onto credits; the two remaining counters stay exactly as they
are (`assertScheduledPostQuota`, `assertConnectedAccountCapacity`, `assertCompanyPagesAccess`
untouched). There is **no coexistence window** for `ai_drafts` — the clean write-over (#100)
deletes the draft path that gated it (#104 §12 removes `createDraft`/`createLinkedInPost`),
so the counter has no remaining caller.

`getDashboardUsage` returns the new shape: `credits` (used/limit/remaining, `-1` for
unlimited) alongside `connected_accounts` and `scheduled_posts`; the `ai_drafts` and
`mark_tokens` keys are dropped.

## 8. Paddle / tier-config implications

- **Each plan's Paddle price maps to a tier, and each tier carries `limits.credits`** —
  the credit allowance is set in tier config next to the existing limits (operator-tuned,
  seeded from: target model cost per average run × expected runs/mo × `CREDIT_MARKUP`).
  Illustrative ladder — free `0` (no AI) or a small trial grant, Starter `2000`, Pro
  `10000`, top tier `-1` (unlimited).
- **Sizing anchor (illustrative, at `CREDITS_PER_USD = 1000`, markup `1.0`):** an
  insight post ≈ research (~$0.02) + generation (~$0.01) + 1 web search (`8`) ≈ **~38
  credits**; a quick post (no research) ≈ **~12 credits**; a carousel adds a `pdf_render`
  (`5`). So "2,000 credits" ≈ 50 insight posts or ~160 quick posts — the operator sizes
  the ladder against these.
- **Upgrades take effect immediately.** The allowance is read live from the resolved tier
  at guard time while the `Usage` aggregate persists, so a mid-period upgrade instantly
  raises headroom without touching usage rows (existing `resolveEntitlementTier` behavior).
  Downgrade lowers the ceiling the same way; a user already over the new ceiling is simply
  blocked until the next period — no clawback.
- **Reset cadence = the existing usage period** (subscription `currentPeriodStart`, or
  UTC-month for default-tier users). Reused verbatim; no new billing wiring.
- **Out of scope for v1 (room left, not built):** credit top-ups / one-off purchases,
  overage billing, and rollover. The whole-number credit unit and the `Usage` aggregate
  leave room for a future top-up (add to allowance or a separate grant bucket) without a
  reshape.

**Rejected — model credits as a Paddle metered/usage-billed item.** Overkill for launch:
prepaid per-tier allowances (what we already have machinery for) cover the plan model; true
metered billing is a later pricing decision, not a launch blocker.

## 9. Visibility

- **Dashboard** — `getDashboardUsage.usage.credits = { used, limit, remaining }`
  (`remaining === -1` when unlimited), for the plan/usage screen.
- **Live (SSE, #107)** — `usage.tick` events carry the per-signal credit delta and running
  `creditsUsed`, so a long research run shows a climbing credit count; the terminal
  `run.completed` / dashboard reflects the committed total. `limit === 0` lets the frontend
  distinguish "AI not on your plan" from "out of credits this period" (carried over from the
  Mark `mark_tokens: 0` convention).

## 10. Error taxonomy

| Condition | Where | Handling |
|---|---|---|
| No balance at request time | HTTP `POST /artifacts` | `FeatureGateForbiddenException` → 403, code `FEATURE_LIMIT_EXCEEDED`, feature `credits` |
| No balance at run start | engine pre-run guard | terminal `WorkflowError` → run/version `FAILED` `"insufficient credits"` (no retry) |
| Debit write fails post-run | `commit` | best-effort: caught + logged; the completed run is **not** failed |
| Missing `usage.cost` | `toCredits` | §2 token fallback + warn log (never charge 0) |

Failed and retried runs debit nothing (#103 §8) — users are charged **once, only for
successful runs**.

## 11. Migration note (clean write-over, #100)

- **Rename** `FEATURE_KEYS.MARK_TOKENS` → `CREDITS` (`'mark_tokens'` → `'credits'`);
  drop `AI_DRAFTS` from `FEATURE_KEYS`, the `Feature`/`Tier.limits` union, and
  `getDashboardUsage`.
- **`FeatureGatingService`:** `assertMarkTokenQuota` → `assertBalance` (headroom check, §6),
  `incrementMarkTokenUsage` → `incrementCreditUsage`/`debit`, `getMarkTokenBudget` folded
  into the `credits` slot of `getDashboardUsage`. Remove `assertAiDraftQuota` /
  `incrementAiDraftUsage` and their callers (the deleted draft path, #104 §12).
- **New `CreditMeterService`** (§4) in the feature-gating module (or a thin `src/credits`
  module importing `FeatureGatingModule`) implementing `toCredits` / `assertBalance` /
  `debit`; the engine composes it + per-run state into `ctx.meter` (#103 §10).
- **Delete** `src/mark` entirely, including the `MarkRun` collection and all `MARK_*` config
  (charter #9); the Tavily helper's surcharge signal is now `web_search` via #104's tool.
- **Config:** add `CREDITS_PER_USD`, `CREDIT_MARKUP`, `FALLBACK_CREDITS_PER_1K_TOKENS`,
  `CREDIT_SURCHARGE_WEB_SEARCH`, `CREDIT_SURCHARGE_PDF_RENDER` to `.env.example`; remove all
  `MARK_*`.
- **Tests** (CLAUDE.md): `credit-meter.service.spec.ts` (conversion per kind incl. fallback
  and rounding; surcharge math) and updated `feature-gating.service.spec.ts` (headroom
  guard, `credits` debit, dashboard shape, `-1`/`0` edge cases), manual construction +
  `makeService()` + `jest.mock(..., { virtual: true })`, run with `bun jest`.

## 12. Boundaries (owned by other tickets)

| Concern | Owner |
|---|---|
| `CreditMeter` hook *timing*, attempt-scoped `creditsUsed`, per-attempt reset, `commit` call site, `usage.tick` emission | #103 |
| Raw usage signals (`usage.cost` per turn, tool-fired), agent max-step cap | #104 |
| `usage.tick` SSE framing / client credit-counter rendering | #107 |
| `pdf_render` surcharge fire site (RENDER_PDF step) | #103 / #108 |
| Concrete per-tier credit allowances, Paddle price↔tier mapping (values) | operator / #110 tier seed |
| Credit top-ups, overage billing, rollover, mid-run cutoff | future |
