# Agent Loop & Research Agent — Design

> Status: design spec for wayfinder map #99, ticket #104 (grilling outcome).
> Author: generated for Christopher Pam. Decisions settled in a grilling session
> on 2026-07-09.
> Supersedes the ad-hoc LLM calls in `src/agent/agent.service.ts` and recovers the
> intent of the deleted `src/mark/mark-agent.service.ts` tool loop — rebuilt on the
> `src/llm` abstraction instead of the Vercel AI SDK.

Feeds the final spec assembly (#110). This ticket owns the **`AgentRunner`** that
#103 hands to steps as `ctx.agent` ("research + generation via the tool-calling
agent loop"). Interlocking tickets are referenced inline at each boundary.

## Framing (charter-derived givens)

- The build flow is **async and non-interactive** (#102/#103: `POST /artifacts` →
  `202 {artifactId, runId}` → progress via SSE). There is **no live user channel**
  mid-run — the agent cannot ask the user questions.
- The agent runs on the **`src/llm` OpenRouter stack**, not the Vercel AI SDK. The old
  `ai` / `@ai-sdk/gateway` deps were deliberately removed when `src/mark` was stripped;
  only `@openrouter/sdk` (^0.13.39), `@tavily/core` (^0.7.3) and `zod` (^4) remain.
- `src/mark` is dissolved (charter #9); its `MARK_*` multi-provider abstraction is
  retired. The surviving `src/mark/search.ts` Tavily helper is the seed for the one
  research tool.
- **Prior art:** the deleted `mark-agent.service.ts` ran a `ToolLoopAgent` with a
  `tools` registry, `stepCountIs(8)` cap, and a Tavily `web_search` tool. This design
  generalizes that loop onto our own abstraction so it is provider-swappable.

---

## 1. Two layers: LLM abstraction vs. the loop

The agent is built in **two layers**, so swapping providers never touches the loop.

**Layer 1 — the LLM abstraction (`src/llm`), provider-swappable.** The strategy
interface grows from today's single `generateCompletion → string` into the
**single-turn, provider-agnostic primitives** the loop needs:

```ts
interface LLMStrategy {
  complete(messages: LLMMessage[], opts?: CompletionOptions): Promise<CompletionResult>;
  completeWithTools(
    messages: LLMMessage[],
    tools: ToolDefinition[],
    opts?: CompletionOptions,
  ): Promise<ToolTurnResult>;                       // ONE turn
  stream?(messages: LLMMessage[], opts?: CompletionOptions): AsyncIterable<string>; // reserved, §10
}

interface CompletionResult { text: string; usage: Usage }
interface ToolTurnResult   { text?: string; toolCalls: ToolCall[]; usage: Usage }

interface ToolDefinition { name: string; description: string; parameters: ZodType }
interface ToolCall       { id: string; name: string; input: unknown }
interface Usage          { promptTokens: number; completionTokens: number; totalTokens: number; cost: number }
```

- New shared types (`ToolDefinition`, `ToolCall`, `Usage`) and the message variants
  (assistant-with-tool-calls, `role: 'tool'` result) are **owned here**.
- The **OpenRouter strategy** implements these using `@openrouter/sdk` primitives
  (floor `0.13.x`) — `z.toJSONSchema` for Zod→JSON Schema conversion, `chat.send` with
  `tools` for the single turn, and the SDK's `usage.cost` for real per-call dollar cost.
  Not the SDK's `tool()` helper (it builds `callModel`'s argument, rejected below), and
  not `usage.costDetails` (upstream wholesale cost, not the account charge). See PRD §7.

**Layer 2 — the `AgentRunner` loop, provider-agnostic.** It owns the multi-turn loop
(tool registry, message accumulation, iteration cap, usage aggregation, stop
condition) by calling `completeWithTools` in a `while` loop. Because the loop sits
**above** the abstraction, changing providers is a strategy swap; the loop is
untouched.

**Rejected — adopt the OpenRouter SDK's full `callModel` orchestrator.** It ships an
automatic multi-turn tool loop, but burying the loop inside the vendor SDK defeats the
provider-swappability the layering exists for. We lean on the SDK's *lower-level*
per-turn helpers (schema conversion, tool-call parsing, usage) and own the loop.

**Rejected — re-add the Vercel AI SDK `ToolLoopAgent`.** Its deps were removed on
purpose; it is a second live LLM vendor path alongside `src/llm`, duplicating the
OpenRouter strategy.

**Rejected — hand-plumb raw OpenAI-style `tools`/`tool_calls` JSON.** More bespoke
message-accumulation and wire code than needed; the SDK's per-turn helpers already do
the JSON.

## 2. The generic loop contract

`AgentRunner` exposes one generic primitive that both concrete agents build on:

```ts
interface Tool<I = unknown, O = unknown> {
  name: string;
  description: string;
  parameters: ZodType<I>;                 // → provider tool-def via Layer 1
  execute: (input: I) => Promise<O>;
}

interface AgentRunConfig {
  system: string;                         // instructions
  messages: LLMMessage[];                 // seed turn(s)
  tools: Tool[];                          // registry for THIS run
  maxSteps: number;                       // iteration cap
  model?: string;
}

interface AgentStep { toolCalls: ToolCall[]; toolResults: unknown[]; usage: Usage }
interface AgentRunResult { text: string; steps: AgentStep[]; usage: Usage }

interface AgentHooks {
  onUsage?: (u: Usage) => void;           // after each LLM turn (§4)
  onToolCall?: (t: { name: string }) => void;
}

run(config: AgentRunConfig, hooks?: AgentHooks): Promise<AgentRunResult>;
```

**The loop:** append seed messages → `completeWithTools` → if `toolCalls` is empty,
return `text`; else execute the called tools (**in parallel within a turn**,
`Promise.all`, matching the old Mark behavior), append their outputs as `role:'tool'`
messages, increment the step counter, repeat.

**Cap behavior — graceful finalization.** When `maxSteps` is reached but the model
still wants tools, make **one final completion with the tools removed** ("budget spent,
answer now"). This guarantees a usable `text` instead of a dangling tool call and
bounds worst-case spend at `maxSteps + 1` LLM calls.

**Rejected — hard stop / throw on cap.** Turns "the model was being thorough" into a
failed run, which #103 would retry into the same cap — wasted spend.

**Rejected — return the last assistant text as-is.** May be empty or half-formed if the
final turn was a pure tool call.

## 3. Public surface — `AgentRunner`

#103 §10 expects `ctx.agent` to provide **research and generation**. Research is
agentic (calls out to the web); generation is not.

```ts
interface AgentRunner {
  research(input: ResearchInput): Promise<ResearchResult>;   // agentic — §5
  generate(input: GenerateInput): Promise<ArtifactContent>;  // single structured completion — §6
}
```

- `research` runs the loop (§2) with the `searchWeb` tool.
- `generate` handles **both** initial and refine (branch on `refine`):

```ts
interface GenerateInput {
  type: ArtifactType;                     // #102 — POST | POLL | DOCUMENT
  prompt: string;
  stylePreset?: StylePreset;
  research?: ResearchResult;              // cached findings (#103 research slot)
  refine?: { priorContent: ArtifactContent; feedback: string };
}
```

- The concrete instance is resolved once in the worker bootstrap and passed as
  `ctx.agent` (the existing `app.get(...)` pattern in `workflow.worker.ts`).

## 4. Generation is a single structured completion, not a loop

`generate` has all its inputs already (prompt + cached research + type); it just emits
**typed `ArtifactContent`** — commentary, a poll object, or document slides —
validated by `ResponseParserService.parseWithSchema` against #102's Zod discriminated
union. It uses Layer 1's `complete` (no tools). This mirrors today's
`createLinkedInPost` / `createDraft` plain completions.

- **Prompt selection per type / per revision is `AgentRunner`'s internal concern**
  (#104 owns the prompts). Refine feeds `priorContent + feedback` into a revision
  prompt; initial feeds `prompt + research`.

**Rejected — generation as an agent loop** (self-validate / self-critique tools).
Unbounded spend and nondeterminism for no launch benefit; #102 already gates `READY`
on a valid render. Parked as future work.

## 5. The research agent

`research()` runs the generic loop with a single tool and full autonomy.

- **Tool — one, `searchWeb` (Tavily).** Built from the surviving `src/mark/search.ts`
  helper, wrapped as a `Tool`: `{ query: string }` → `{ results: {title,url,content,
  score}[] }`, `searchDepth: 'advanced'`, `maxResults: 5`. On failure it returns
  `{ error }` (never throws — §8). The registry stays open so YouTube-transcript /
  Reddit sources can be added later, but launch ships the single web-search tool the
  charter names.
- **Fully autonomous — no `ask_clarification`.** Nowhere to deliver a question in the
  async model. The agent **self-directs its own search queries** across turns (parallel
  searches within a turn allowed). This **replaces** today's `generateSearchKeywords` +
  `searchWithFallbacks` pre-steps — there is no separate keyword-generation stage.
- **Iteration cap `maxSteps = 5`**, config-driven (`RESEARCH_MAX_STEPS`): a few search
  rounds, then synthesize. The §2 graceful finalization guarantees a written findings
  result even at the cap.

```ts
interface ResearchInput { prompt: string; type: ArtifactType; stylePreset?: StylePreset }
```

**Rejected — port YouTube + Reddit + web as three tools now.** Triples the tool
surface, cost, and prompt-tuning for launch; the heavy legacy YouTube pipeline
(search→transcript→compress) dies with the old engine (#100 resolution).

**Rejected — keep a clarification path.** No channel to surface the question in the
fire-and-forget flow.

## 6. Research output shape

`research()` reduces the raw `AgentRunResult` into the "findings + sources" object the
issue names — what GENERATE reads and #103 caches on `WorkflowRun.researchContext`.

```ts
interface ResearchSource { title: string; url: string }
interface ResearchResult {
  findings: string;                       // the loop's final synthesized brief (= AgentRunResult.text)
  sources: ResearchSource[];              // deduped from every searchWeb result across steps
}
```

- Derivation inside `research()`: `findings = result.text` (the agent's own synthesis
  after searching); `sources = dedupeByUrl(steps.flatMap(searchWeb results →
  {title,url}))`.
- **Raw search bodies stay in `steps` (logged) and are not forwarded** — GENERATE gets
  the distilled `findings`, not a dump of five 5-result payloads, keeping the generation
  prompt tight. `sources` travels forward so a post can optionally cite/attribute.
- Zod-validated (repo convention for structured data). Stored verbatim on
  `researchContext`, so **refine reuses it with zero re-search** (the #103 §11 cache;
  no web-search surcharge on refine).

**Rejected — forward raw results** (`sources` with `content`/`score`). Bloats the
generation prompt and the run record with text the `findings` already distilled.

## 7. Usage & cost accounting (→ #105)

`AgentRunner` must **not** hold the meter (that couples the loop to #105). The seam is
a **per-turn hook the step bridges to `ctx.meter`**:

- The loop invokes `hooks.onUsage(usage)` after **each** `completeWithTools` / `complete`
  turn (real `usage.cost` from the SDK) and `hooks.onToolCall({name})` when a tool
  fires.
- The RESEARCH / GENERATE step wires those to `ctx.meter.record(...)`:
  - each LLM turn → `record({ kind: 'llm', amount: usage.cost, detail: { model, totalTokens } })`
  - each web-search call → `record({ kind: 'web_search', amount: 1 })` — the *signal*
    #105 turns into a surcharge.
- `AgentRunner` also returns aggregate `usage` on `AgentRunResult` for the run record /
  logging.

Live per-turn emission lets #107's SSE show a running token/credit count during a long
research run. **`AgentRunner` emits raw signals (cost per turn, tool fired); #105 owns
converting them to credit amounts and surcharge rates** — clean boundary.

**Rejected — return aggregate usage only, record once after `run()`.** No live ticks
(a 6-step research run reports nothing until it finishes) and tool-surcharge signals get
lost.

## 8. Error taxonomy

Three failure modes, each mapped onto #103's retry model (`WorkflowError{retryable}` →
BullMQ `attempts:3`; terminal → `UnrecoverableError`):

| Failure | Handling | Engine effect |
|---|---|---|
| **Tool execution error** (Tavily down / timeout / throws) | caught, returned to the model as tool-result `{ error }`; loop continues (agent adapts, bounded by `maxSteps`) | none — absorbed in-loop |
| **LLM transport error** (429 / 5xx / network) | `src/llm` classifies and throws typed `LLMError{ retryable }` (429/5xx/network = retryable; 4xx/auth = terminal); `AgentRunner` propagates | step maps to `WorkflowError{retryable}` → whole run retried, or terminal |
| **Bad structured output** (generation fails #102 Zod) | **one inline repair retry** in `generate()` (re-prompt with the validation error); still invalid → throw `retryable` | #103 `attempts` re-runs (research cached, so cheap) |

- The `src/llm` layer owns retryable classification because it knows provider error
  semantics.
- Nothing here charges the user (#103 §9: commit-on-success only; failed/retried runs
  cost the user nothing).

## 9. Provider scope & model selection

- **OpenRouter-only for v1**, on the single `src/llm` abstraction. Only the OpenRouter
  strategy implements the new `complete` / `completeWithTools` / `usage` surface. The
  `LLMProvider` enum keeps its `OPENAI` / `CLAUDE` arms unimplemented (as today); the §1
  layering makes adding a real Claude/OpenAI strategy later a strategy addition, not a
  loop change.
- **`MARK_*` provider-switching is retired.** OpenRouter already fronts 300+ models, so
  "switching providers" in practice means switching the OpenRouter model string.
- **Per-role model config** via `ConfigService`: `RESEARCH_MODEL` (fast, for tool-loop
  turns) and `GENERATION_MODEL` (stronger, for final content) — no hardcoded model
  strings (retires the scattered `gemini-3-flash` / `gpt-5.4` / `gpt-5-mini` literals,
  per AGENTS.md's config rule).

**Rejected — reinstate a multi-provider abstraction now** (port Mark's gateway/anthropic
paths). Two+ live SDKs, more config and test surface, for a launch where OpenRouter
covers every model we'd reach for.

## 10. Streaming scope

- **Token streaming is deferred.** v1 `AgentRunner` uses only non-streaming `complete` /
  `completeWithTools`. `stream()` stays an **optional, unimplemented method on the
  strategy interface** — the seam is reserved, nothing calls it.
- Live progress comes entirely from #103/#107 events (step started/completed, live
  `usage.tick` from §7's hook) — enough for a "researching… generating…" UI with a
  running token/credit count, without token-level plumbing.

**Rejected — implement token streaming now.** Forces backpressure/buffering in the
loop, a token-delta event type into #107's contract, and breaks the
validate-after-completion model (you cannot Zod-validate a half-streamed object).

## 11. Boundaries (owned by other tickets)

| Concern | Owner |
|---|---|
| `ctx.agent` wiring, `WorkflowRun` record, retry/`WorkflowError` semantics, `ctx.meter` interface | #103 |
| `ArtifactContent` Zod discriminated union, `ArtifactWriter`, version status | #102 |
| Credit denomination, `cost`/tool signals → credit conversion, surcharge rates, optional mid-run cutoff | #105 |
| SSE endpoint, client event schema, `usage.tick` framing, `Last-Event-ID` replay | #107 |
| `Slide` internal shape / carousel templates (what DOCUMENT generation emits per slide) | #108 |
| Post binding, connected-account, publish | #106 |
| Additional research sources (YouTube-transcript, Reddit tools); token streaming; multi-provider strategies | future |

## 12. Migration note

Per the #100 resolution this is a clean write-over (relaunch, no users):

- **`src/llm`**: extend `LLMStrategy` with `complete` / `completeWithTools` / (reserved)
  `stream`; add the shared `ToolDefinition` / `ToolCall` / `Usage` types and tool/tool-
  result message variants; implement them in the OpenRouter strategy over
  `@openrouter/sdk` (≥ `0.13.x`) using `z.toJSONSchema` + `chat.send`; add typed
  `LLMError{retryable}`.
- **New `AgentRunner`** (in `src/agent`) owning the generic loop (§2) and the
  `research` / `generate` surface (§3), plus the research/generation/refine prompts.
- **`searchWeb` tool** wrapping `src/mark/search.ts` (Tavily); `src/mark` otherwise
  dissolved.
- **Delete** the ad-hoc pipeline methods in `agent.service.ts`
  (`generateUserIntent`, `generateSearchKeywords`, `searchWithFallbacks`,
  `getYouTubeTranscripts`, `extractInsight`, `createDraft`, `createLinkedInPost`,
  `updateDraft`) — folded into `research()` + `generate()` — and their `PostDraft`
  coupling.
- Config: add `RESEARCH_MODEL`, `GENERATION_MODEL`, `RESEARCH_MAX_STEPS`, `TAVILY_API_KEY`;
  retire `MARK_*`.
