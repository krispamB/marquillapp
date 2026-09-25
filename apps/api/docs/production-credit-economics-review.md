# Production Credit Economics Review

Use this workflow only after either one complete paid billing cycle or a cohort
of 100–200 paid users. It turns a normalized production export plus a named
owner's pricing decision into the evidence record required by issue #148. The
command rejects an ineligible cohort, incomplete artifact coverage, missing
provider invoices, unowned decisions, approved changes without implementation
issues, and unlimited paid credit allowances.

## Run the review

Prepare the normalized JSON described below, then run:

```bash
npm run review:credit-economics -- ./private/credit-economics-input.json docs/credit-economics-review-YYYY-MM.md
```

Keep raw exports and invoices outside the repository because they may contain
customer or vendor-sensitive data. Commit only the generated Markdown evidence
record after the owner has verified its totals and recorded all five decisions.

## Input contract

The top-level object has four fields:

- `cohort`: a `billingCycle` with ISO `start`, ISO `end`, and `complete`, plus
  opaque `users`. Each paid-user row supplies its stable export ID, tier, finite
  allowance, exhaustion status, and recognized subscription revenue. Cohort
  size and tier economics are derived from these rows instead of accepted as
  summary assertions. An incomplete cycle is accepted only for 100–200 users.
- `runs`: normalized workflow observations with a unique `runId`, cohort
  `userId`, in-window `occurredAt`, `artifactType` (`POST`, `POLL`, or
  `DOCUMENT`), `withResearch`, settled `credits`, successful Tavily lookup
  count, Browserless units for every render attempt, whole-job `attempts`, final
  `status`, and observed `providerCostUsd` split across OpenRouter, Tavily, and
  Browserless. Supply at least one completed observation for each of the six
  artifact × research combinations.
- `providerInvoices`: at least one `OPENROUTER`, `TAVILY`, and `BROWSERLESS`
  invoice row with `amountUsd`, the exact billing-window `periodStart` and
  `periodEnd`, and a non-secret evidence `reference`. Each provider total must
  reconcile to observed run cost within the larger of $1 or 1%.
- `decision`: the human `owner`, ISO `decidedAt`, and one item for each of
  `MARKUP`, `SEARCH_PRICING`, `RENDER_PRICING`, `TIER_ALLOWANCES`, and `TOP_UPS`.
  Every item is `RETAIN` or `CHANGE` with a rationale. A change requires an
  `implementationIssue` in this repository; a tier-allowance change also
  requires finite positive `proposedTierAllowances` for all three paid tiers.

Example decision item:

```json
{
  "area": "SEARCH_PRICING",
  "action": "CHANGE",
  "rationale": "Observed Tavily invoice cost exceeds the launch envelope.",
  "implementationIssue": "https://github.com/krispamB/linkgenserver/issues/200"
}
```

## Preparing production evidence

Use opaque or hashed stable identifiers for paid users in the selected billing
window; do not put customer PII in the normalized export. Join each workflow run
to its paid user and artifact to obtain the billing tier, `artifactType`, and
`withResearch`. Use the final settled credit count for successful runs and the
retained attempt telemetry for retry/failure analysis. Browserless units come
from `WorkflowRun.renderAttempts`; include successful and failed render attempts
so invoice exposure is visible.

Successful Tavily lookup counts, whole-job attempt counts, and per-run provider
cost attribution must be assembled from retained application/queue observability
and vendor exports for the same window. Do not infer provider economics from raw
token counts: OpenRouter's reported cost and actual Tavily and Browserless
invoice evidence are the source of truth.

The analyzer reconciles each provider's invoice total against observed run cost
before it will generate a report. The report also shows the aggregate delta.

## Metric definitions

- Artifact credit p50/p95 uses nearest-rank percentiles per artifact and
  research flag.
- Tavily metrics are successful lookups per research run.
- Browserless metrics are measured 30-second units per render attempt.
- Retry rate is the share of workflow observations with more than one attempt.
- Failure rate is the share whose final status is `FAILED`.
- Exhaustion is exhausted paid users divided by paid users for each tier.
- Realized gross margin is `(subscription revenue - attributed provider cost) /
subscription revenue`, compared with the launch full-exhaustion floors of 90%
  for Starter, 75% for Creator, and 50% for Pro Writer.

The report is evidence for a human pricing decision, not an automatic repricing
mechanism. Approved changes belong in separate implementation issues, and paid
provider-backed usage must remain finite.
