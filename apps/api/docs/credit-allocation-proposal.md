# Credit Allocation and Provider-Usage Pricing Proposal

> Status: approved launch policy; the Free allocation choice is recorded in
> [free-credit-allocation-decision.md](./free-credit-allocation-decision.md).
> Date: 2026-07-13.
> Scope: free-tier allocation, Tavily research charges, Browserless rendering
> charges, and the existing paid-tier ladder. No application code is changed by
> this document.

## Executive recommendation

Adopt a cost-backed credit with a **2× markup** over provider cost:

```text
1 app credit = $0.001 of provider cost × 2
credits = ceil(provider_cost_usd × 1,000 × 2)
```

Keep the LLM portion priced from the provider-reported OpenRouter cost. Price
non-LLM services from their actual provider units:

| App event | Provider cost basis | Recommended app charge |
|---|---:|---:|
| Tavily `advanced` search | 2 Tavily API credits × $0.008 = $0.016 | **32 credits per successful lookup** |
| Browserless PDF render | 1 unit per 30 seconds; use 2 units as the normal safety envelope | **8 credits per successful render** |
| Browserless render above 2 units | $0.002/unit conservative overage basis | **4 credits per measured unit** |

The Browserless recommendation uses the highest published paid overage rate as a
conservative cost basis. The actual included-unit cost on a subscription plan is
usually lower, so this leaves room for Browserless subscription overhead and
occasional failed attempts.

## Free tier

Set the Free tier to:

| Limit | Recommendation |
|---|---:|
| Monthly credits | **120** |
| Research/web search | **Disabled** |
| Connected accounts | Keep current value: 1 |
| Scheduled posts | Keep current value: 1 |

At the current repository estimates, a no-research run is approximately:

- Post: about 24 credits after the 2× markup.
- Poll: budget about 24 credits.
- Document: about 24 credits for generation plus 8 credits for rendering =
  about 32 credits.
- All three: about 80 credits, leaving roughly 40 credits for normal variation.

This makes 120 credits a practical shared monthly grant for a useful mix of
posts, polls, and documents without research. It costs very little even at the
conservative peg: 120 credits correspond to $0.06 of provider cost before any
vendor-plan discounts.

The approved product boundary is a **shared best-effort allowance**, not a
per-artifact guarantee. A user can spend all 120 credits on any supported mix.
Product copy must therefore say “120 credits per month for AI posts, polls, and
documents. Usage varies by what you create” and must not promise one artifact of
each type. See the linked decision document for reset, exhaustion, and
implementation semantics.

Free users should never be allowed to turn on `withResearch`; otherwise the free
grant becomes an uncontrolled Tavily subsidy. Research should be an explicit paid
plan capability, separate from the credit balance.

## Tavily research pricing

Tavily documents the following Search costs:

- `basic`, `fast`, and `ultra-fast`: 1 Tavily API credit.
- `advanced`: 2 Tavily API credits.
- Pay-as-you-go: $0.008 per Tavily API credit.

The repository's search tool explicitly requests `searchDepth: 'advanced'`, so the
correct provider-cost calculation for the current path is:

```text
2 Tavily credits × $0.008 = $0.016 per successful lookup
$0.016 × 1,000 × 2 = 32 app credits
```

Therefore, replace the current illustrative 8-credit surcharge with **32 app
credits per successful advanced search**. Charge only successful searches, which
matches the current tool behavior and avoids charging a user for an outage that
returned no results.

The research agent currently permits up to five loop steps, but loop steps and
search calls are not necessarily identical. For predictable cost, the product
policy should cap a research run at **five successful Tavily lookups**. At that
cap, the search component alone is at most 160 credits; the research model's
OpenRouter cost is charged separately.

### What a research run costs

The user-facing charge should be:

```text
research credits = OpenRouter research-model cost × 1,000 × 2
                 + successful Tavily searches × 32
```

This is fairer than charging one flat “research” price because a short research
run pays for fewer searches, while a thorough run pays for the provider usage it
actually consumed. The 32-credit search surcharge is still highly profitable at
the existing paid-tier prices:

| Tier | Price | Credits | Effective price of 32-credit lookup | Provider cost | Gross margin on lookup* |
|---|---:|---:|---:|---:|---:|
| Starter | $9.99 | 2,000 | $0.160 | $0.016 | 90% |
| Creator | $19.99 | 10,000 | $0.064 | $0.016 | 75% |
| Pro Writer | $29.99 | 30,000 | $0.032 | $0.016 | 50% |

\*Before payment processing, hosting, support, and any fixed vendor subscription
costs. These are bundle-equivalent economics, not a separate per-search price.

## Browserless pricing and proposed render charge

Browserless does not publish a flat per-PDF price. It bills browser time in units:

```text
1 unit = up to 30 seconds of one browser connection
units = ceil(session_seconds / 30)
```

The current public paid overage rates are:

| Browserless plan | Included units/month | Overage |
|---|---:|---:|
| Prototyping | 20,000 | $0.0020/unit |
| Starter | 180,000 | $0.0017/unit |
| Scale | 500,000 | $0.0015/unit |

The repository renders one complete document in one `/pdf` request, not one
request per slide. For a normal render that completes within 30 seconds, the
provider charge is one unit. A 31–60 second render costs two units. Since render
time is variable and transient failures are currently absorbed rather than
charged to users, use this launch policy:

- Charge **8 credits per successful document render**. This covers two units at
  the conservative $0.002/unit rate with the 2× markup.
- Render duration is now observable. Charge **4 credits per measured
  Browserless unit**, with an 8-credit minimum, using
  `units = max(1, ceil(duration_ms / 30,000))`.
- Do not charge by slide count; Browserless bills browser time, not PDF pages.
- Do not include residential proxy or CAPTCHA surcharges in the document price
  unless the rendering path starts using those features. The current local HTML
  render should not need them.

At the existing paid-tier prices, an 8-credit render has bundle-equivalent prices
of $0.040, $0.016, and $0.008 on Starter, Creator, and Pro Writer respectively.
Using $0.004 as the conservative two-unit provider cost, that gives approximate
gross margins of 90%, 75%, and 50% respectively.

## Paid-tier allocation

Keep the current paid prices and most current allowances, but remove unlimited
credits from Pro Writer. Unlimited provider-backed usage creates an uncapped cost
liability and conflicts with the profitability goal.

| Tier | Monthly price | Recommended monthly credits | Research | Rationale |
|---|---:|---:|---|---|
| Free | $0 | **120** | No | Shared across any mix of posts, polls, and documents without research |
| Starter | $9.99 | **2,000** | Yes | Retains the current allowance; roughly 80 quick no-research runs |
| Creator | $19.99 | **10,000** | Yes | Retains the current allowance; meaningful research capacity |
| Pro Writer | $29.99 | **30,000** | Yes | Replaces uncapped usage with a high but bounded allowance |

At a 2× markup, the maximum provider-cost exposure represented by each paid
allowance is approximately $1, $5, and $15 respectively. Before fixed costs, the
resulting maximum gross margins are approximately 90%, 75%, and 50%. Actual
margin should be higher because most customers will not exhaust their allowance.

The 30,000-credit Pro Writer ceiling is deliberately conservative. If production
data shows that Pro users routinely hit the ceiling, increase it only after
checking actual vendor cost and retention—not by making it unlimited. A future
top-up pack can serve heavy users without turning the subscription into unlimited
vendor exposure.

## Guardrails needed for the proposal to remain profitable

1. **Research capability gate:** Free cannot invoke Tavily, regardless of remaining
   credits.
2. **Search-call cap:** cap successful Tavily calls per research run at five.
3. **Successful-run settlement:** keep the current policy of charging only the
   successful run. The 2× markup and Browserless render minimum provide failure
   buffer; monitor retry rates.
4. **Provider-cost source of truth:** keep LLM charges based on OpenRouter's
   reported `usage.cost`, not a fixed token estimate.
5. **Browserless telemetry:** append duration, actual units, outcome, and failure
   stage for every render attempt. Charge only the winning workflow using
   `max(8, 4 × measured_units)`; retain failed-attempt telemetry for cost audit.
6. **No unlimited tier:** every paid plan needs a finite allowance or explicit
   paid top-up/overage policy.
7. **Review after real usage:** after the first 100–200 paid users or one full
   billing cycle, compare the p50/p95 credits per artifact and provider invoices
   against this proposal. Reprice from observed cost, not from token counts alone.

## Source notes

Provider facts are documented in [credit-allocation-pricing-research.md](./credit-allocation-pricing-research.md).
The most important first-party sources are:

- [Tavily Credits & Pricing](https://docs.tavily.com/documentation/api-credits)
- [Tavily Search API reference](https://docs.tavily.com/documentation/api-reference/endpoint/search)
- [Browserless pricing](https://www.browserless.io/pricing)
- [Browserless unit consumption](https://docs.browserless.io/overview/unit-consumption)
- [Browserless PDF API](https://docs.browserless.io/rest-apis/pdf-api)
- [OpenRouter GPT-5.4 pricing](https://openrouter.ai/openai/gpt-5.4/pricing)
- [OpenRouter GPT-5 Mini pricing](https://openrouter.ai/openai/gpt-5-mini/pricing)

The repository-specific assumptions come from [credit-usage-system-design.md](./credit-usage-system-design.md), [artifact-workflow-step-pipelines-design.md](./artifact-workflow-step-pipelines-design.md), the current tier seeds in `src/scripts/tier-seeds.ts`, and the current `searchWeb` and Browserless PDF paths.
