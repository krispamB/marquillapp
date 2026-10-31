# Anthropic provider: design decisions

Written 2026-10-30. The cost comparison and the case for native web search are in [anthropic-tokens-and-web-search.md](anthropic-tokens-and-web-search.md); this note records how the provider is built.

## Why

Production runs Claude Haiku 5.5 through OpenRouter with BYOK (our own Anthropic key). OpenRouter reports `usage.cost: 0` for BYOK calls, so `CreditMeterService.llmCredits` fell back to its flat 10 credits per 1k tokens, about 25 to 50 times Haiku's real price. Two fixes ship together:

1. **OpenRouter BYOK cost.** When `usage.cost` is 0 or missing, `OpenRouterStrategy` uses `usage.costDetails.upstreamInferenceCost` (the provider's own charge, which OpenRouter reports for BYOK calls). This alone stops the overcharge on the current setup.
2. **A first-class Anthropic provider**, `AnthropicStrategy`, which calls the Messages API directly and prices each call itself.

## Shape

- `LLM_PROVIDER` (`openrouter` by default, or `anthropic`) is read once by `AgentRunnerService` and used for every call it makes. Any other value fails worker boot. `LLMProvider.ANTHROPIC = 'anthropic'` is a new member; the unused `LLMProvider.CLAUDE` placeholder is left as it was, so no stored value or caller changes meaning.
- `AnthropicStrategy` uses the global `fetch` (injectable through the `ANTHROPIC_FETCH` token so specs stub it), not `@anthropic-ai/sdk`. It needs no extra dependency, and we own every request byte.
- `ANTHROPIC_API_KEY` is read at boot but checked only when a call is made, so a deployment that never selects Anthropic needs no key. With `LLM_PROVIDER=anthropic`, `AgentRunnerService` fails worker boot without the key, or when a configured model is not a Claude model. `OpenRouterStrategy` still requires `OPENROUTER_API_KEY` at boot, because the module builds both strategies.

## API version: `2026-10-21`

`ANTHROPIC_VERSION` defaults to `2026-10-21`, the newest version and the one current SDKs send. On it, `temperature`, `top_p` and `top_k` return a 400 on every model, so the strategy never sends them, whatever the version; `CompletionOptions.temperature` is ignored. Nothing in the app sets a non-default temperature, and Haiku 5.5, Sonnet 5.5 and Opus 5.5 accept only the default anyway. The version's other changes (no `document` block in an assistant turn, no `citations` on user text) do not arise: cited text only ever goes back inside the assistant turn that produced it.

## Requests and responses

- **Messages.** System messages are joined into the top-level `system`. An assistant turn's tool calls become `tool_use` blocks; tool results become `tool_result` blocks; consecutive turns of the same role are merged, so one turn's tool results go back in a single user message.
- **Thinking blocks.** Haiku 5.5 thinks by default, and a tool loop must send each assistant turn's blocks (thinking included) back unchanged. `ToolTurnResult.providerContent` carries the raw blocks, and `AgentRunnerService.run` copies them onto the `AssistantMessage` (`providerContent`), which the strategy re-sends verbatim. OpenRouter never sets it, so its requests are unchanged.
- **Effort and structured output** go in `output_config`: `effort` (the app's `minimal` and `none` map to `low`, the lowest Anthropic effort; there is no portable way to turn thinking off) and `format: { type: 'json_schema', schema }`. The Zod schema is converted with `z.toJSONSchema`, then reduced to the subset structured outputs accepts: `oneOf` becomes `anyOf`, every object gets `additionalProperties: false`, and numeric, length and complex array constraints are dropped. `ResponseParserService` still validates against the unchanged Zod schema.
- **No forced `tool_choice`** (it 400s on Opus 5.5 and Sonnet 5.5), no assistant prefill, no `sessionId` equivalent (it is ignored).
- **Stop reasons.** `end_turn` becomes `finishReason: 'stop'` and `max_tokens` becomes `'length'`; others pass through. A `length` cut-off with no text returns `text: ''`, as OpenRouter does. `refusal` throws a terminal `LLMError`. A tool call cut off at `max_tokens` throws a retryable `LLMError` rather than handing out truncated input.
- **Streaming.** With `onTextDelta`, the request streams over SSE and is rebuilt into the same message an unstreamed call returns (text, thinking, signatures, tool input and citations per block; usage from `message_start` overlaid with `message_delta`). An `error` event is classified by its type's HTTP status (`overloaded_error` is 529).

## Retries: shared loop, `ANTHROPIC_*` keys

The OpenRouter retry loop moved from `openrouter-retry.ts` into `strategies/llm-retry.ts` as `sendWithRetries`, labelled per provider; `OpenRouterStrategy`'s behaviour, messages and spec are unchanged. `AnthropicStrategy` uses the same loop with its own `ANTHROPIC_TIMEOUT_MS`, `ANTHROPIC_MAX_ATTEMPTS`, `ANTHROPIC_RETRY_BASE_MS`, `ANTHROPIC_RETRY_MAX_DELAY_MS` and `ANTHROPIC_RETRY_BUDGET_MS`, with OpenRouter's defaults, so each provider can be tuned alone. Errors are shaped for the existing `toLLMError`: an HTTP error carries its status and headers (408, 429 and 5xx including 529 retry, `retry-after` is honoured), a network failure is a retryable `ConnectionError`, a body that is not a message is retryable, and a caller's abort is never retried.

## Model ids

`toAnthropicModelId` (`src/llm/anthropic-model.ts`) accepts OpenRouter slugs, so `GENERATION_MODEL` and `RESEARCH_MODEL` work under either provider: `anthropic/claude-haiku-5.5` loses the prefix (and any `:variant` suffix) and its dots become dashes, giving `claude-haiku-5-5`. API ids pass through. Anything that is not a Claude model throws. The default model is `claude-haiku-5-5`.

## Pricing table

The API returns token counts but no dollars, so `src/llm/anthropic-pricing.ts` owns the prices, in USD per million tokens:

| Model | Input | Output | Cache read | Cache write (5 min) |
| --- | --- | --- | --- | --- |
| `claude-haiku-5-5`, prompt ≤ 100K tokens | 0.10 | 0.50 | 0.01 | 0.125 |
| `claude-haiku-5-5`, prompt > 100K tokens | 0.50 | 2.50 | 0.05 | 0.625 |
| `claude-sonnet-5-5` | 2 | 10 | 0.20 | 2.50 |
| `claude-opus-5-5` | 4 | 20 | 0.20 | 5 |

A 1-hour cache write costs twice the input rate. Server-side web search costs $0.01 per request (`usage.server_tool_use.web_search_requests`); its result tokens are already in `input_tokens`. The Haiku tier is decided per request by the whole prompt: fresh, cache-read and cache-write tokens together. `Usage.promptTokens` is that same total.

**Updating it.** Edit `ANTHROPIC_PRICES` and its spec from the pricing page when a price changes or a model is added. A model missing from the table reports cost `0` and the strategy logs a warning once per model; the meter then bills its flat token fallback, which overcharges, so add the model before switching to it.

## Native research and its billing rule

`RESEARCH_MODE=native` is one `RESEARCH_MODEL` call with the web search server tool (`max_uses` = `RESEARCH_MAX_SUCCESSFUL_SEARCHES`, 120 s per try). It needs `LLM_PROVIDER=anthropic`; any other combination fails worker boot. `OpenRouterStrategy` throws a terminal `LLMError` if asked for `webSearch`.

- **Tool version.** `web_search_20260209` (dynamic filtering) on models that support it, such as Opus 5.5 and Sonnet 5.5; `web_search_20250305` otherwise, including Haiku 5.5. A paused server-tool turn (`stop_reason: 'pause_turn'`) is re-sent up to 5 times, then returned with `finishReason: 'pause_turn'`. A failed search comes back as HTTP 200 with an error result; it is logged, and the model carries on.
- **Result.** `findings` is the model's synthesis and `sources` are the pages it cited (`CompletionResult.citations`), deduped by normalised URL, with `mode: 'native'`. GENERATE reads it as research findings, unchanged.
- **Billing.** The call is recorded as one `llm` usage whose cost already includes $0.01 per search. `onToolCall` never fires, so the 32-credit `web_search` surcharge (Tavily's) is **not** charged on top. The search count travels as `Usage.webSearchRequests`, into the usage detail (`UsageDetail.webSearchRequests`) and the run's `llmUsage.webSearchRequests`, which appear only when a call searched.
- **Evaluation.** `bun run eval:research --modes agent,snippets,native` adds native mode to the A/B; the default modes are unchanged.

With none of the new keys set, every request, usage record and run record is exactly what it was before.
