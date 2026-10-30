# Anthropic direct vs OpenRouter, and native web search vs Tavily

Audience: the product owner. Written 2026-10-30 for the decision on two questions:

1. Should the API call Anthropic directly instead of going through OpenRouter (BYOK)?
2. Should research use the model's built-in web search instead of Tavily?

Nothing here is a decision. Prices and API facts come only from the sources listed at the end, and
every figure names its source in brackets. Anything the sources did not confirm is marked
**unconfirmed**. The measured runs are from the owner's local database, not production.

Source tags used below: [models] = `shared/models.md`, [caching] = `shared/prompt-caching.md`,
[cost] = `shared/cost-optimization.md`, [tools] = `shared/tool-use-concepts.md`,
[platform] = `shared/platform-availability.md`, [mac] = `shared/managed-agents-core.md`,
[mat] = `shared/managed-agents-tools.md`, [errors] = `shared/error-codes.md`,
[migr] = `shared/model-migration.md`, [curl] = `curl/examples.md`, [tavily] = Tavily API credits page,
[meter] = `src/feature-gating/credit-meter.*`, [data] = the owner's measured runs.

## 1. TL;DR

- **Going direct makes the bill exact.** On OpenRouter BYOK, every Haiku 5.5 call reported cost 0, so
  the credit meter fell back to 10 credits per 1k tokens [data][meter]. Calling Anthropic returns exact
  token counts (including cache reads and writes). The app would price tokens itself from a price table.
- **The fallback overcharges Haiku heavily.** Recomputed at real Haiku 5.5 prices, the measured runs
  should have cost 3.4x to 15x fewer credits than charged (section 4). A research DOCUMENT charged 739
  credits should have been about 197, of which 160 is the five Tavily searches.
- **Real vendor cost per artifact on Haiku 5.5 is small.** LLM tokens for a research DOCUMENT run
  about $0.014; the five Tavily searches add $0.04 (pay-as-you-go, basic). Search is the larger cost,
  not the model. Sonnet 5.5 is exactly 20x Haiku per token ($2/$10 vs $0.10/$0.50).
- **Prompt caching is available direct, but worth little in dollars on Haiku.** Reads cost 0.1x. The
  most it could save on the 15.4k-token DOCUMENT prompt is about $0.0014 per run (about 3 credits). It
  matters more for latency and for Sonnet (about $0.028 per run on the same prompt).
- **Native web search is one request instead of a tool loop, but it is not cheaper.** It costs $10 per
  1,000 searches ($0.01 each) plus result tokens as input [mac]. Five searches cost $0.05, against
  $0.04 on Tavily basic pay-as-you-go and $0.025 on the Tavily Growth plan [tavily].
- **Haiku 5.5 is not on the list of models that get dynamic filtering** [tools]. It would use the older
  `web_search_20250305` tool. Sonnet 5.5 and Opus 5.5 get `web_search_20260209`.
- **Web search options, not a decision:** (A) keep Tavily `agent` or `snippets`; (B) add
  `RESEARCH_MODE=native` as an opt-in and A/B it with `bun run eval:research`; (C) later, replace
  Tavily only if the checklist in section 5.7 passes. B costs only the eval spend and is reversible.
- **The main cost of going direct is lock-in and accounting work:** a price table in the app, a
  per-token cost calculation, 429 handling with Anthropic's own limits, and losing OpenRouter's
  single-key access to other vendors' models.

## 2. What Anthropic tokens buy you

### 2.1 Models and prices

All prices are per million tokens (MTok), standard (non-batch) rates.

| Model (alias) | Input | Output | Cache read | Cache write 5 min / 1 h | Context / max output | Source |
|---|---|---|---|---|---|---|
| Haiku 5.5 (`claude-haiku-5-5`), prompt <= 100K | $0.10 | $0.50 | $0.01 (0.1x) | $0.125 / $0.20 (1.25x / 2x) | 1M / 128K | [models][migr] |
| Haiku 5.5, prompt > 100K | $0.50 | $2.50 | $0.05 (0.1x, derived) | $0.625 / $1.00 (derived) | same | [models][migr] |
| Sonnet 5.5 (`claude-sonnet-5-5`) | $2 | $10 | $0.20 | $2.50 / $4 | 1M / 128K | [models][migr] |
| Opus 5.5 (`claude-opus-5-5`) | $4 | $20 | $0.20 | **unconfirmed** (1.25x / 2x would be $5 / $8) | 1M / 128K | [models][caching] |

Notes:

- The Haiku tier is chosen per request by prompt length. The 100K threshold is a prompt size, not a
  monthly volume. All measured runs spread their tokens over several calls, and no single call is
  likely near 100K, but per-call prompt sizes were not in the data, so this is **unconfirmed** for the
  DOCUMENT draft call.
- Haiku 5.5's cache read rate is stated as 0.1x of input and write multipliers as 1.25x (5 min) and 2x
  (1 h) [migr][caching]. The dollar figures for Haiku cache reads and writes are my arithmetic from
  those multipliers.
- Haiku 5.5 uses a newer tokenizer that counts the same text as about 30% more tokens than Haiku 4.5
  [models]. The measured runs already use Haiku 5.5 tokens, so no adjustment is needed for the
  recomputation in section 4.
- Output tokens include thinking. The "completion tokens (incl. reasoning)" in the measured data are
  billed as output [data]. Haiku 5.5 omits thinking text from responses by default but it is still
  generated and billed. That the thinking is billed as output is **unconfirmed** in the sources I read
  for Haiku specifically; it is the standard behaviour I am assuming.

### 2.2 What direct gives you that OpenRouter BYOK did not

| Capability | Direct to Anthropic | Through OpenRouter BYOK (as measured) |
|---|---|---|
| Usage and cost | Response `usage` has `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` [caching]. The Messages response carries tokens, not dollars (no cost field appears in the sources; **unconfirmed** that none exists). The app must price tokens itself. | `usage.cost` was 0 for every Haiku 5.5 call, so the meter used the 10 credits per 1k fallback [data][meter]. |
| Prompt caching | Explicit `cache_control` breakpoints, or top-level automatic caching. Read/write multipliers above. | `cachedTokens` was 0 on all Haiku runs [data]. Whether OpenRouter forwards `cache_control` is **unconfirmed**. |
| Effort and thinking | `output_config.effort` and `thinking` set exactly (section 2.4). | OpenRouter maps its own `reasoning` options; the mapping to Anthropic's was not checked (**unconfirmed**). |
| Structured output | `output_config.format` with `{"type":"json_schema","schema":...}` [migr]. Replaces prefill. | Passed through the OpenRouter structured-output option today. |
| Batch API | 50% off every token, including cache reads and writes, results within 24 hours [cost]. | Not available through the chat completions route (**unconfirmed**). |
| Citations | Documented as a feature (`citations`) [migr]; see the web search section. | n/a |
| Files API | Documented as a feature for uploading and referencing files [cost]. | n/a |
| Rate limits | 429 `rate_limit_error` on requests per minute, tokens per minute, or tokens per day, with `retry-after` and `x-ratelimit-*` headers [errors]. The actual limits for our account tier are **unconfirmed** (not in the sources). | OpenRouter's own limits (not reviewed). |
| Vendor and model choice | Anthropic models only. | Any model on the router, including the OpenAI-family models used in the last run. |

### 2.3 Prompt caching, with an estimate

How it works [caching]:

- The cache is a prefix match. Render order is `tools`, then `system`, then `messages`. A single byte
  changed before a breakpoint invalidates everything after it.
- The minimum cacheable prefix on Haiku 5.5, Sonnet 5.5 and Opus 5.5 is 512 tokens. Shorter prefixes
  silently do not cache. (The source says to check the caching docs before relying on this value.)
- Default TTL is 5 minutes; `"ttl": "1h"` costs 2x to write. A read refreshes the timer at no extra cost.
- Break-even with the 5-minute TTL is two requests: 1.25x + 0.1x = 1.35x against 2x uncached.
- Server tools such as web search automatically insert a 5-minute cache write after tool results when
  the request already uses caching. That shows up as cache writes you did not mark, and is expected.

What is cacheable in this app. `apps/api/src/agent/prompts/artifact-generation.prompts.ts` is about
15.4 KB and `research.prompts.ts` about 3.7 KB (file sizes; at roughly 4 characters per token the
generation prompt is about 4k tokens, an estimate). The no-research DOCUMENT run used 15,408 prompt
tokens in total [data], so the rest of the prompt is the brief, the design-system context and the
generation instructions. I do not have the split. The estimate below therefore uses a stable prefix
of N tokens and shows the formula; plug in the real N once the engineer logs it.

Formulas per request, for a stable prefix of N tokens at input price p per MTok:

- Uncached: N x p / 1,000,000.
- Cache hit: N x 0.1 x p / 1,000,000. Saving per hit = N x 0.9 x p / 1,000,000.
- First write (5 min): N x 1.25 x p / 1,000,000. Extra over uncached = N x 0.25 x p / 1,000,000.

| Scenario | Haiku 5.5 (p = $0.10) | Sonnet 5.5 (p = $2) |
|---|---|---|
| Prefix N = 10,000 (assumed system prompt plus design system), saving per hit | 10,000 x 0.9 x 0.10 / 1e6 = **$0.0009** (about 1.8 credits at 2,000 credits per USD) | 10,000 x 0.9 x 2 / 1e6 = **$0.018** (36 credits) |
| Write premium for that prefix, paid once per 5 minutes | 10,000 x 0.25 x 0.10 / 1e6 = $0.00025 | 10,000 x 0.25 x 2 / 1e6 = $0.005 |
| Upper bound: the whole 15,408-token DOCUMENT prompt were cacheable | 15,408 x 0.9 x 0.10 / 1e6 = $0.00139 (2.8 credits) | 15,408 x 0.9 x 2 / 1e6 = $0.0277 (55.4 credits) |
| Research DOCUMENT run: 35,770 prompt tokens over several calls; suppose 60% are re-reads of an earlier turn's prefix inside the loop (assumption) | 21,462 x 0.9 x 0.10 / 1e6 = $0.0019 (3.9 credits) | 21,462 x 0.9 x 2 / 1e6 = $0.0386 (77 credits) |

Reading this honestly: on Haiku 5.5 caching saves under a fifth of a cent per run. The case for it is
latency (**unconfirmed**; the sources describe cost, and I did not find latency figures) and keeping
cost flat if the model is moved up to Sonnet. Caching also needs the two fixed-prefix rules:
put the date (`today.prompt.ts`) and the brief after the breakpoint, and keep the design-system block
byte-identical between requests. A reused design system across a user's burst of documents within five
minutes is the realistic hit pattern; one document a day gets no hits and pays the 1.25x write.

### 2.4 Effort, thinking and defaults

| Model | Thinking | Effort levels | Default effort | Source |
|---|---|---|---|---|
| Haiku 5.5 | Adaptive only, on by default. `{"type":"disabled"}` is accepted at effort high or below, 400 at xhigh/max. `budget_tokens` returns 400. | low through max | medium | [models][migr] |
| Sonnet 5.5 | Adaptive, on by default. `{"type":"disabled"}` returns 400; use `{"type":"between_tools"}` at effort high or below to turn thinking off. | low/medium/high/xhigh/max | high | [models] |
| Opus 5.5 | Always on. `disabled` returns 400 at every effort. | effort is the only control | medium | [models][curl] |

Our env: `RESEARCH_REASONING_EFFORT=medium` matches the Haiku default; `DOCUMENT_DRAFT_REASONING_EFFORT=high`
is one step above it. Haiku 5.5 thinking counts toward `max_tokens`, so a small cap can be consumed by
thinking and stop with `stop_reason: "max_tokens"` before any text [migr]. Any call site that sets a
small `max_tokens` (for example the snippets query call) should be checked for this.

Effort is the lever for cost on the measured numbers. The DOCUMENT run produced 21,141 completion
tokens including reasoning; at $0.50/MTok that is $0.0106, about three quarters of the LLM cost for
that run [data]. Lowering draft effort is the biggest token lever, and it is a quality tradeoff
to be tested, not a free win [cost].

### 2.5 Structured outputs, batch, citations, Files

- **Structured outputs.** `output_config: {"format": {"type": "json_schema", "schema": SCHEMA}}`
  [migr]. This is also the documented replacement for assistant prefill, which Haiku 5.5 rejects.
  Supported on every platform listed [platform]. Our snippets mode and the artifact schemas already
  rely on structured output.
- **Batch API.** 50% off all tokens including cache reads and writes; results arrive within 24 hours
  and that window is an expiry, not an SLA; each request is single-shot, so no tool loop inside a
  batch [cost]. At 50%, Haiku 5.5 would be $0.05 in / $0.25 out and Sonnet 5.5 $1 / $5 (my arithmetic
  from the standard rates). This suits eval runs (`document-eval-runbook.md`, `text-eval-runbook.md`)
  for the draft and review steps that are one call. It does not suit the research tool loop or any
  user-waiting request.
- **Citations.** Listed as an API feature [migr]. Note that on API version `2026-10-21` a user message
  containing a `text` block with a non-empty `citations` array returns an error, so never replay
  citation-bearing assistant text back as user text [migr].
- **Files API.** For uploading a file once and referencing it in messages [cost]. Not needed for the
  current artifacts; relevant if users upload PDFs or brand assets to be read by the model
  (**unconfirmed** whether that is on the roadmap).

### 2.6 Limits and gotchas for the provider code

| Gotcha | Detail | Source |
|---|---|---|
| No `temperature`, `top_p`, `top_k` | On API version `2026-10-21` any of the three returns 400 on every model, even at the default value. Also applies to each request inside a Batch. | [migr] |
| No prefill | A trailing assistant turn returns 400 on Haiku 5.5. Use `output_config.format`. | [errors][migr] |
| Forced `tool_choice` | `{type:"any"}` or `{type:"tool"}` returns 400 on Sonnet 5.5 and Opus 5.5 (and Fable 5.1). Use `{type:"auto"}` plus a prompt instruction, or structured outputs. Whether Haiku 5.5 does the same is **unconfirmed**: the error table lists the other four but not Haiku. Treat it as unsafe. | [errors] |
| `refusal` stop reason | Safety classifiers can return HTTP 200 with `stop_reason: "refusal"`. Haiku 5.5 has no server-side fallback. Check `stop_reason` before reading `content`. | [models] |
| Preserved thinking | Editing earlier turns in a replayed history invalidates thinking blocks; thinking blocks are tied to the model and conversation. Do not rewrite or trim history in the agent loop; do not replay Haiku thinking to another model. | [models] |
| Required headers | `x-api-key`, `anthropic-version: 2026-10-21`, `Content-Type: application/json`. Endpoint `POST https://api.anthropic.com/v1/messages`. Beta features need `anthropic-beta`. | [curl] |
| Retries | 429 and 5xx are retryable. SDKs retry by default; the raw HTTP provider needs its own retry loop, as `OpenRouterStrategy` has today. | [errors] |
| Max tokens | Set `max_tokens` high enough for thinking plus the artifact. Max output is 128K on all three models. | [models] |

## 3. Reference: how the meter charges today

From `credit-meter.constants.ts` and `credit-meter.service.ts` [meter]:

- LLM credits = ceil(costUsd x 1000 x 2) when the provider reports a positive cost.
- If cost is missing or 0: ceil(totalTokens / 1000 x 10).
- Each Tavily search: 32 credits (`CREDIT_SURCHARGE_WEB_SEARCH`).
- PDF render: max(units x 4, 8) credits.
- Each charge is rounded up per call, so a run with several calls overshoots the sum of exact figures
  by up to one credit per call. The small gaps in section 4 are that rounding.

Observation on the 32-credit surcharge: 32 credits = $0.016 at 2,000 credits per USD, which is exactly
2x Tavily's basic pay-as-you-go price of $0.008 per search [tavily]. It is priced for `basic`. Advanced
searches cost 2 credits each, $0.016 pay-as-you-go [tavily], so at advanced depth the surcharge would
recover only 1x. The current `.env` uses `TAVILY_SEARCH_DEPTH=basic`, so it matches.

## 4. Cost per artifact, recomputed

### 4.1 Method

For each measured run [data]:

- Haiku USD = prompt x $0.10/1e6 + completion x $0.50/1e6 (completion includes reasoning).
- LLM credits = ceil(USD x 1000 x 2).
- Search credits = 32 x Tavily searches.
- Render credits = 8 per render. The data gives renders, not render units. Because max(units x 4, 8)
  has a floor of 8, one render is 8 credits when units is 1 or 2; more than 2 units would cost more.
  Render units are **unconfirmed**; I use 8.
- Should have cost = LLM credits + search credits + render credits.
- Sonnet USD = 20 x Haiku USD, because Sonnet 5.5 is $2/$10 against Haiku $0.10/$0.50 and both ratios
  are exactly 20 [models]. Sonnet credits use the same formula.
- All prompts are priced at the <= 100K tier. Prices apply per request; token counts in [data] are run
  totals.
- Rounding is applied once per run, not per call; the real meter would add up to one credit per call.

### 4.2 Arithmetic, run by run

| # | Run | Haiku input | Haiku output | Haiku USD |
|---|---|---|---|---|
| 1 | DOCUMENT, research | 35,770 x 0.10/1e6 = 0.003577 | 21,141 x 0.50/1e6 = 0.010571 | 0.014148 |
| 2 | DOCUMENT, research | 35,096 x 0.10/1e6 = 0.003510 | 14,076 x 0.50/1e6 = 0.007038 | 0.010548 |
| 3 | DOCUMENT, no research | 15,408 x 0.10/1e6 = 0.001541 | 10,286 x 0.50/1e6 = 0.005143 | 0.006684 |
| 4 | DOCUMENT refine | 5,828 x 0.10/1e6 = 0.000583 | 2,917 x 0.50/1e6 = 0.001459 | 0.002041 |
| 5 | POST, research | 37,042 x 0.10/1e6 = 0.003704 | 4,532 x 0.50/1e6 = 0.002266 | 0.005970 |
| 6 | POST | 1,022 x 0.10/1e6 = 0.000102 | 459 x 0.50/1e6 = 0.000230 | 0.000332 |
| 7 | POLL | 1,255 x 0.10/1e6 = 0.000126 | 700 x 0.50/1e6 = 0.000350 | 0.000476 |
| 8 | DOCUMENT, research (Luna run, repriced as Haiku, cache ignored) | 69,433 x 0.10/1e6 = 0.006943 | 18,764 x 0.50/1e6 = 0.009382 | 0.016325 |

### 4.3 Credits: what it should have cost against what was charged

"Should" = LLM + searches + render. Charged is from [data].

| # | Run | LLM credits (Haiku) | Search (32 x n) | Render | **Should (Haiku)** | **Charged** | Charged / should | Sonnet 5.5 USD | **Should (Sonnet)** |
|---|---|---|---|---|---|---|---|---|---|
| 1 | DOCUMENT, research | ceil(28.3) = 29 | 160 | 8 | **197** | 739 | 3.8x | 0.2830 | ceil(565.9) = 566, +168 = **734** |
| 2 | DOCUMENT, research | ceil(21.1) = 22 | 160 | 8 | **190** | 661 | 3.5x | 0.2110 | ceil(421.9) = 422, +168 = **590** |
| 3 | DOCUMENT, no research | ceil(13.4) = 14 | 0 | 8 | **22** | 266 | 12.1x | 0.1337 | ceil(267.4) = 268, +8 = **276** |
| 4 | DOCUMENT refine, no research | ceil(4.1) = 5 | 0 | 8 | **13** | 96 | 7.4x | 0.0408 | ceil(81.7) = 82, +8 = **90** |
| 5 | POST, research | ceil(11.9) = 12 | 160 | 0 | **172** | 578 | 3.4x | 0.1194 | ceil(238.8) = 239, +160 = **399** |
| 6 | POST | ceil(0.66) = 1 | 0 | 0 | **1** | 15 | 15x | 0.0066 | ceil(13.3) = 14 |
| 7 | POLL | ceil(0.95) = 1 | 0 | 0 | **1** | 1 | 1x | 0.0095 | ceil(19.0) = 20 |
| 8 | DOCUMENT, research (gpt-6-luna-pro, cost reported) | repriced: ceil(32.65) = 33 | 160 | 8 | **201** (if Haiku) | 199 | about 1x | 0.3265 | ceil(653.0) = 654, +168 = **822** |

Checks that the fallback explains the charged numbers (tokens / 1000 x 10, plus surcharges):

- Run 1: (35,770 + 21,141) / 1000 x 10 = 569.1; + 160 + 8 = 737.1. Charged 739. The 2-credit gap fits
  per-call rounding over several calls.
- Run 2: 49,172 / 1000 x 10 = 491.7; + 168 = 659.7. Charged 661.
- Run 3: 25,694 / 1000 x 10 = 256.9; + 8 = 264.9. Charged 266.
- Run 4: 8,745 / 1000 x 10 = 87.5; + 8 = 95.5. Charged 96.
- Run 5: 41,574 / 1000 x 10 = 415.7; + 160 = 575.7. Charged 578.
- Run 6: 1,481 / 1000 x 10 = 14.8. Charged 15.
- Run 7: 1,955 / 1000 x 10 = 19.6, yet 1 credit was charged. This does not match the fallback and I
  cannot explain it from the data. It may have used a model that reported a cost; **unconfirmed**.
  Treat the POLL row as unreliable.
- Run 8 is a different model with a reported cost: 199 - 160 - 8 = 31 LLM credits, which is about
  $0.0155 at 2,000 credits per USD. That is close to the repriced Haiku figure ($0.0163), so on that
  one run the OpenAI-family model and Haiku 5.5 cost about the same in tokens.

What this says:

1. The fallback rate is a flat blended 10 credits per 1k tokens (about $0.005 per 1k at the 2x markup).
   Haiku's real blended rate is about $0.0001-0.0005 per 1k tokens. The fallback is 10x to 50x too
   high at the LLM level, which is why no-research runs show 7x to 15x overcharge.
2. With exact pricing, the Tavily surcharge becomes most of the credit bill for research runs:
   160 of 197 (81%) for run 1 and 160 of 172 (93%) for run 5. On Sonnet 5.5 the model is the larger
   part again: 566 of 734 for run 1.
3. If pricing is corrected, a user's credit allotment buys many more Haiku artifacts than it does
   today. That is a pricing and tier question (`credit-allocation-proposal.md`,
   `production-credit-economics-review.md`), not a code question; I did not check what tiers assume.
4. Real vendor cost, not credits, for run 1 on Haiku direct: $0.0141 (tokens) + 5 x $0.008 = $0.04
   (Tavily basic pay-as-you-go) = **$0.054**, plus render cost (Browserless; not in the data).
   Revenue-equivalent at the recomputed 197 credits is 197 / 2000 = $0.0985 (2x markup on the LLM
   part and the surcharge at 2x Tavily PAYG).

## 5. Web search corner

This section is the practical part. Facts are marked with their source; where the bundled API
reference is silent, the line says **unconfirmed** and names what to check on the live docs
(`platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool`, listed in `live-sources.md`
as a page to fetch before building).

### 5.1 How the server-side `web_search` tool works

- **One request.** You add a tool definition and Claude runs queries, fetches, and result processing
  server-side [tools]. There is no client-side tool loop to build: no `searchWeb` tool, no
  `maxSteps`, no result round trip. The API runs its own sampling loop.
- **The model decides.** The model chooses when to search and what to ask. You do not give it queries
  (unlike `snippets`, where our first call writes the queries).
- **Tool definition.**

  ```json
  { "type": "web_search_20260209", "name": "web_search" }
  ```

  [tools]. The older version is `web_search_20250305`.
- **Two versions.** `web_search_20260209` has dynamic filtering: Claude writes and runs code to filter
  results before they enter the context window, built in with no extra tool or beta header [tools].
  Models that get it: Opus 5.5, Opus 5, Fable 5, Opus 4.8, Opus 4.7, Opus 4.6, Sonnet 5.5, Sonnet 5,
  Sonnet 4.6 [tools]. **Haiku 5.5 is not on that list**, so use `web_search_20250305` there. The code
  execution used for filtering is free when used with web search/fetch [tools].
  Do not also declare a standalone `code_execution` tool alongside the `_20260209` versions; it creates
  a second execution environment that can confuse the model [tools].
- **Platform availability.** Web search is on the Claude API, and not on every cloud. On Vertex and
  Foundry (Azure) only the basic `web_search_20250305` exists [platform]. Direct Claude API is the
  full-featured route.
- **`max_uses`.** Caps searches per request. I could not confirm the field's exact semantics for the
  Messages API in the bundled sources (it appears there only for the advisor tool, with a different
  meaning). **Unconfirmed**; the task brief names it, so verify on the live page. It is the control
  that matches `RESEARCH_MAX_SUCCESSFUL_SEARCHES=5`.
- **Domain allow and block lists, `user_location`.** The bundled reference documents these for
  Managed Agents [mat], and the Messages tool is expected to take the same shapes (**unconfirmed**
  for the Messages API):
  - `allowed_domains` and `blocked_domains` are mutually exclusive on one entry; 1-64 hostnames each;
    plain hostnames only (no scheme, port or wildcard); a listed domain covers its subdomains.
  - A search silently omits results outside the list; `web_fetch` returns an error result.
  - `user_location`: `{ "type": "approximate", city?, region?, country? (ISO 3166-1 alpha-2),
    timezone? (IANA) }`, at least one optional field. Some countries are rejected by the search
    provider [mat].
  Useful for us: `allowed_domains` could pin research to trusted outlets for a fixed client brief;
  `user_location` could localise results for non-US users.
- **Results and citations.** Search results arrive as blocks in the response content, and the model's
  text carries `citations` with URLs. The exact block names and fields (`server_tool_use`,
  `web_search_tool_result`, `web_search_result_location`) are **unconfirmed** in the bundled sources.
  Plan to store the cited URLs from the response itself, not to ask the model to write them.
  Do not replay a `text` block with non-empty `citations` back inside a user message on
  `2026-10-21`; it errors [migr].
- **Errors.** Per the task brief, a failed search arrives as HTTP 200 with an error object in the
  result block, not as an HTTP error. This is **unconfirmed** in the bundled sources (the closest
  documented pattern is the advisor tool, where errors are `*_result_error` objects inside a 200
  response [tools]). The provider code must therefore inspect result blocks, not only HTTP status.
- **`pause_turn`.** The server-side loop has a default limit of 10 iterations. At the limit the
  response has `stop_reason: "pause_turn"`. To continue, send the user message and the assistant
  content back unchanged, with no extra "Continue" message; the server resumes where it left off
  [tools]. Set a continuation cap (the source suggests about 5) so a loop cannot run forever
  [tools]. Each resume is another request billed for its tokens.
- **Refusal.** A response can also stop with `refusal` (section 2.6).

### 5.2 Billing

- **$10 per 1,000 searches**, so $0.01 per search [mac]. Plus the search results counted as input
  tokens on the request (the brief says so; the sources I read state the per-search fee only, so the
  "results billed as input" part is **unconfirmed** in the bundled reference).
- With Haiku 5.5 input at $0.10/MTok, 25,000 tokens of results cost $0.0025, so the per-search fee
  dominates on Haiku (five searches = $0.05). On Sonnet 5.5, the same 25,000 tokens cost $0.05, which
  matches the search fee.
- Server tools add a 5-minute cache write after tool results when caching is on [caching].
- The meter today sees web search only as a 32-credit surcharge per Tavily call. For native search, the
  engineer needs a rule for how many credits to charge per native search. To keep the same 2x markup
  on vendor cost, the arithmetic is $0.01 x 1000 x 2 = **20 credits per search**, against 32 for Tavily
  basic. This is arithmetic, not a recommendation. How native searches are counted in `usage` on the
  Messages API is **unconfirmed** (the Managed Agents `usage.server_tool_use` field shows request
  counts [mac]; I did not find the Messages equivalent).

### 5.3 Side by side: Tavily `agent`, Tavily `snippets`, native

Current `.env`: `RESEARCH_MODEL=anthropic/claude-haiku-5.5`, `TAVILY_SEARCH_DEPTH=basic`,
`RESEARCH_MAX_SUCCESSFUL_SEARCHES=5`, `RESEARCH_REASONING_EFFORT=medium`.

| Dimension | Tavily `agent` (default) | Tavily `snippets` | Native `web_search` |
|---|---|---|---|
| How it runs | App-owned tool loop. Model calls `searchWeb` (5 results each), app runs Tavily, feeds results back. Up to `maxSteps` = 5 (+ a finalisation call). | One model call writes 1-4 queries as structured output; searches run in parallel; excerpts deduped and capped at 10 x 600 chars. | One request. Model searches inside the server loop; app continues on `pause_turn`. |
| LLM round trips | Measured 2-3 research calls [data]; worst case 6 | 1 query call, then no more research calls | 1 (plus continuations on `pause_turn`) |
| Search round trips | Sequential across steps (a step can issue several) | Parallel, one wave | Server-side, invisible to the app |
| Latency | Not measured here; **unconfirmed**. Loop adds one LLM latency per step. | Expected lowest of the Tavily modes; **unconfirmed** | Expected fewer app round trips; total latency **unconfirmed** and must be measured |
| Search cost per run (5 searches) | 5 x $0.008 = **$0.040** PAYG, $0.025 Growth [tavily] | up to 4 x $0.008 = $0.032 PAYG, $0.020 Growth (max 4 queries) | 5 x $0.010 = **$0.050** [mac] |
| Model-token cost, Haiku 5.5 | Measured research turns: 26-36k tokens [data]; $0.003 to $0.018 (see 5.4) | One short call (small); then the excerpts add input tokens to GENERATE | Result tokens as input; likely similar range to measured; **unconfirmed** |
| Total per research run (Haiku) | about $0.043 to $0.058 PAYG | about $0.035 to $0.04 (my estimate; query call not measured) | about $0.053 to $0.068 |
| Accuracy and freshness | Tavily relevance score and snippet text; depth `basic` is shallow | Raw excerpts only, capped at 600 chars each | Quality is the provider's; no head-to-head data. **Unconfirmed**; this is what the eval must show. |
| Citations | We build `[n] Title (url)` findings ourselves from Tavily results | Same, numbered findings | Model text with `citations` and URLs from the API (exact shape **unconfirmed**) |
| Control over sources | Full: query text, depth, results count, our own filtering | Full on queries; none after | `allowed_domains` / `blocked_domains` / `user_location` / `max_uses`; no control over ranking |
| Failure modes | Tavily timeout (10 s) comes back as `{ error }` and the model adapts [`search-web.tool.ts`]; search fault never fails the run | A failed search simply contributes no excerpts | Errors in a 200 body; `pause_turn`; `refusal`; unknown behaviour on search outage. Whole research fails or degrades as one unit. |
| Vendor lock-in | Tavily plus any LLM | Tavily plus any LLM | Anthropic only; direct API only (Vertex and Foundry have basic search only [platform]) |

Per-run cost arithmetic (Haiku 5.5, search fee only, 5 searches):

- Tavily basic PAYG: 5 x 1 credit x $0.008 = $0.040. Growth: 5 x $0.005 = $0.025 [tavily].
- Tavily advanced PAYG: 5 x 2 credits x $0.008 = $0.080. Growth: 5 x 2 x $0.005 = $0.050 [tavily].
- Native: 5 x $10 / 1000 = $0.050 [mac].

So native equals Tavily advanced on the Growth plan and is 25% more than Tavily basic PAYG ($0.05 vs
$0.04), twice Tavily basic on Growth ($0.05 vs $0.025).

### 5.4 Model-token cost inside a research run

The measured research turns used 26-36k tokens across 2-3 calls [data]. The input/output split is
not in the data. Bounds on Haiku 5.5:

- All input: 26,000 x $0.10/1e6 = $0.0026; 36,000 x $0.10/1e6 = $0.0036.
- All output: 26,000 x $0.50/1e6 = $0.013; 36,000 x $0.50/1e6 = $0.018.
- The truth lies between. Research turns are mostly input (search results plus history), so expect the
  low end, about $0.003 to $0.006.

On Sonnet 5.5 (20x): input-only $0.052 to $0.072; output-only $0.26 to $0.36. On Sonnet the model
tokens, not the search fee, drive research cost.

Totals per research run at 5 searches, Haiku 5.5 (search fee plus bounds above):

- Tavily agent basic PAYG: $0.040 + $0.003 to $0.018 = **$0.043 to $0.058**.
- Native: $0.050 + $0.003 to $0.018 = **$0.053 to $0.068**, assuming native result tokens match
  Tavily's. **Unconfirmed**; native results may be larger or smaller.
- Difference at the same token cost: native is $0.010 more per run, about 20 credits at 2,000 credits
  per USD.

### 5.5 Perks and trade-offs

Perks (what native would give us):

- Less code to maintain: no tool loop, no step cap, no successful-search counter, no Tavily client or
  timeout setting.
- Fewer app-side round trips; the search-and-read loop is inside one billed request.
- Citations come from the API with URLs, which may be sturdier than the model copying URLs from
  excerpts into the brief.
- Dynamic filtering on Sonnet 5.5 and Opus 5.5 trims results before they enter context, which can cut
  input tokens (token savings **unconfirmed**; measure).
- Domain allow and block lists and `user_location` are first-class settings (shape **unconfirmed** for
  Messages).
- One vendor to bill, one invoice, one set of failure modes to monitor.

Trade-offs:

- It costs more per search than Tavily at every Tavily tier except advanced on Growth.
- It is not available on Haiku 5.5 with dynamic filtering; the filtered, token-efficient path needs a
  model 20x more expensive per token.
- The model decides how much to search. `max_uses` bounds it, but you lose the exact "successful
  search" accounting that makes the credit meter predictable. `pause_turn` continuations can add
  requests.
- Less visibility into what was searched and why unless the response blocks are logged.
- No equivalent of the `snippets` mode's cheap, parallel, bounded design.
- All-in on Anthropic for research as well as generation. With OpenRouter, a different model can still
  be paired with Tavily.
- Search result quality is unmeasured on our briefs.
- Web content flows into the model's context; the usual prompt-injection care applies equally to
  Tavily excerpts and native results.

### 5.6 How to try it

This is what the engineer is adding; names are from the task brief and `apps/api/AGENTS.md`.

1. In `apps/api/.env`, set `LLM_PROVIDER=anthropic`, the Anthropic API key (variable name is whatever
   the engineer defines), and model names in Anthropic form (for example `claude-haiku-5-5`, not
   `anthropic/claude-haiku-5.5`). Model ID format is from [models].
2. Set `RESEARCH_MODE=native`. Existing values stay valid: `agent` and `snippets` (anything else fails
   worker boot).
3. Run `bun run eval:research` from `apps/api`. It researches fixed POST and DOCUMENT briefs in each
   mode and reports latency, calls, searches and findings size, and it needs only `.env`, not Mongo,
   Redis or the worker (`apps/api/AGENTS.md`). **It spends real money on Anthropic and, for the
   Tavily modes, Tavily.** Expected spend at five searches per brief is the figures in 5.4: about
   $0.05 to $0.07 per native run on Haiku, so a full A/B across the fixed briefs is cents on Haiku
   and dollars on Sonnet.
4. Keep Tavily for one more reason: run both on the same briefs so differences are the search, not the
   week's news.
5. To stay inside a budget, set `max_uses` to the same value as `RESEARCH_MAX_SUCCESSFUL_SEARCHES`
   (5), and cap `pause_turn` continuations (the source suggests about 5 [tools]).
6. Log, for every native run: searches used, result tokens, cited URLs, `stop_reason`, and any error
   object in result blocks.

### 5.7 Decision checklist: what to measure before replacing Tavily

Run the same fixed briefs through `agent`, `snippets` and `native`, at least 10 briefs per artifact
type, several times each.

| Measure | How | Replace Tavily only if |
|---|---|---|
| Total cost per research run | LLM tokens at real prices, plus search fee, from logs | Native within about 25% of Tavily agent on Haiku (expected gap is $0.010), or the quality gain justifies it |
| Wall-clock latency, p50 and p95 | `eval:research` latency | Native is not slower than `agent`; ideally close to `snippets` |
| Searches actually used | Count from response | Stays at or below `max_uses`; no runaway |
| Citation validity | Open every cited URL; check it supports the claim | At least as good as Tavily-based findings, with no fabricated or dead URLs |
| Freshness | Briefs about events in the last 7 days | Finds recent sources as often as Tavily |
| Output quality | Blind-compare the resulting artifacts (documents, posts) on fixed rubrics, as in the eval runbooks | No regression |
| Failure rate | Count errors in 200 bodies, `pause_turn`, `refusal`, empty results, 429s | Failures are no more frequent than Tavily timeouts, and fail gracefully |
| Token use of results | Input tokens added per search | Not far above the measured 26-36k for research turns |
| Dynamic filtering effect | Haiku (basic tool) against Sonnet 5.5 (`_20260209`) | Know whether the cheaper model can reach acceptable quality without it |
| Credit meter fit | Native search counts reach the meter and charge the intended credits | Engineer confirms exact search counts are available per request |
| Domain control | Test `allowed_domains` on a brief with known sources | Works as expected for our needs |
| Lock-in cost | Effort to switch back (the Tavily path stays in code) | Tavily modes stay available via `RESEARCH_MODE` |

## 6. Recommendations and open questions

Recommendations, framed as options for the owner:

1. **Go direct for accounting, even if nothing else changes.** The measured overcharge (3.4x to 15x on
   Haiku) comes from the missing cost on OpenRouter BYOK, and it goes away with a price table in the
   app. Decide first whether credits should follow real cost, then adjust the 10-credits-per-1k
   fallback either way, because it also covers any future provider that reports no cost.
2. **Do not count on caching for savings on Haiku.** Add `cache_control` on the static prefix because
   it is cheap to do, helps latency, and protects cost if the model moves to Sonnet, but do not put
   the savings in the business case: about $0.001 per run on Haiku.
3. **Treat effort as the main cost control.** About three quarters of a Haiku DOCUMENT run's LLM cost
   is output (reasoning plus content). Test `DOCUMENT_DRAFT_REASONING_EFFORT` at medium against high
   on the eval set before changing it.
4. **Use the Batch API for evals** where each call is single-shot: 50% off, 24-hour window.
5. **Native web search: try it behind the flag, do not replace Tavily yet.** The data shows no cost
   advantage and no quality data. The upside is simpler code and API-backed citations.
6. **If Tavily stays, consider `snippets`** for the low-latency, low-cost end; it caps at 4 searches
   and was designed for that.
7. **Fix the surcharge assumptions together.** 32 credits per search matches Tavily basic at 2x. If
   native search is added at $0.01, the 2x-equivalent is 20 credits. If advanced depth is used, 32 is
   a 1x price.

Open questions (each is either **unconfirmed** or needs a decision):

- What is the Anthropic account's tier and rate limit (RPM, input and output TPM) for Haiku 5.5? Not
  in the sources.
- Does Haiku 5.5 reject forced `tool_choice` like Sonnet 5.5 and Opus 5.5? The error table does not
  list it.
- What are the exact Messages API shapes for `web_search`: `max_uses`, result and citation blocks, error
  object, usage counters for searches? Fetch the live web-search page before building.
- Are search result tokens billed as input, and how large are they on our briefs? Needs a logged run.
- How long does a native research run take against the current `agent` loop? Not measured.
- What is the split of the 15,408-token DOCUMENT prompt between the fixed system prompt, design-system
  context and the brief? Needed to size the caching estimate.
- Why did the POLL run charge 1 credit when the fallback would give about 20?
- How many render units did each DOCUMENT render use? The recomputation assumes the 8-credit floor.
- Does OpenRouter BYOK forward `cache_control` and report cost for Anthropic models at all? The runs
  showed cost 0 and no cached tokens; why is not established. It may be fixable on the OpenRouter side
  and would change the comparison.
- Are there OpenRouter BYOK fees on top of Anthropic's price? Not in the sources.
- Does the business want to keep multi-vendor model choice (OpenAI-family models were used in the last
  run) or commit to Anthropic only?
- Zero-data-retention and data-handling terms for direct Anthropic use against what OpenRouter offers
  today: not reviewed.

## Sources

Bundled Claude API reference (root:
`/private/tmp/claude-501/bundled-skills/2.1.314/fdbdfb5b7ff4ce497ad730e41d79e45a/claude-api/`). There
was no `SKILL.md` at that root; the files read were:

- `shared/models.md` (model IDs, prices, context, descriptions)
- `shared/prompt-caching.md` (multipliers, TTLs, minimums, server tool cache writes)
- `shared/cost-optimization.md` (batch at 50%, levers)
- `shared/tool-use-concepts.md` (web search / web fetch versions, dynamic filtering, `pause_turn`,
  code execution free with web tools)
- `shared/platform-availability.md` (web search per platform)
- `shared/managed-agents-core.md` ($10 per 1,000 web searches; `server_tool_use` usage)
- `shared/managed-agents-tools.md` (domain lists, `user_location` shapes; Managed Agents, not Messages)
- `shared/error-codes.md` (429, forced `tool_choice`, sampling and prefill errors)
- `shared/model-migration.md` (Haiku 5.5 and Sonnet 5.5 sections, `output_config.format`)
- `shared/api-version-migration.md` (`2026-10-21`: sampling parameters, citations)
- `shared/live-sources.md` (live doc URLs for Files API, Citations, Structured Outputs)
- `curl/examples.md` (headers, endpoint, caching and thinking request shapes)

External:

- Tavily API credits: https://docs.tavily.com/documentation/api-credits.md (basic search = 1 credit,
  advanced = 2 credits, pay-as-you-go $0.008 per credit, $0.005 on Growth, as given in the task brief;
  not re-fetched by me)

This repository (read-only):

- `apps/api/AGENTS.md` (env vars, `RESEARCH_MODE`, `eval:research`)
- `apps/api/CONTEXT.md` (domain terms: Artifact, Document Version, Candidate Source)
- `apps/api/src/feature-gating/credit-meter.constants.ts`
- `apps/api/src/feature-gating/credit-meter.service.ts`
- `apps/api/src/agent/research-snippets.ts`
- `apps/api/src/agent/tools/search-web.tool.ts`
- `apps/api/src/agent/prompts/` (file sizes only)
- Measured runs: supplied by the owner in the task brief, from the local database.
